import type { Classifier, ClassificationResult } from '../classifier/types.ts';
import type { ClassificationTaxonomy } from '../domain/taxonomy.ts';
import { validateTaxonomy } from '../domain/taxonomy.ts';
import { fetchMessageContext, serializeContextForClassifier, type MessageContext } from '../gmail/context-builder.ts';
import type { GmailClient, GmailMessage } from '../gmail/types.ts';
import { classifyOperationalError, describeOperationalError, isGmailQuotaError, requiresGmailReconnect } from './retry-policy.ts';
import type { RateGovernor } from './limiter.ts';

export type ProcessOutcome = 'processed' | 'already_processed' | 'deferred' | 'failed_permanent' | 'failed_transient';

type ConfigSnapshot = {
  hash: string;
  provider: string;
  model: string;
  globalInstructions: string;
  taxonomyJson: string;
};

type SuccessfulAttempt = {
  messageId: string;
  configHash: string;
  labelId: string;
  probabilities: Record<string, number>;
  confidence: number | null;
  provider: string;
  model: string;
  usage: { input_tokens?: number; output_tokens?: number; cost_cents?: number };
  createdAt: number;
};

type ProcessorRepositories = {
  installation: { get(): any; patch?(value:any):void };
  config: { getActive(): ConfigSnapshot | null; get(hash: string): ConfigSnapshot | null };
  attempt: { getSuccessful(messageId: string): SuccessfulAttempt | null; saveSuccess(value: SuccessfulAttempt): void };
  audit: { complete(value: any): void };
  error?: { add(value:any):void };
};

type Governor = Pick<RateGovernor, 'canStart' | 'recordUsage'>;

type ProcessorOptions = {
  gmail: GmailClient;
  classifier: Classifier;
  repos: ProcessorRepositories;
  governor: Governor;
  now?: () => number;
  loadContext?: (gmail: GmailClient, messageId: string) => Promise<MessageContext>;
  maxClassifierStateChars?: number;
};

class PermanentProcessingError extends Error {}

function parseTaxonomy(config: ConfigSnapshot): ClassificationTaxonomy {
  let taxonomy: ClassificationTaxonomy;
  try { taxonomy = JSON.parse(config.taxonomyJson) as ClassificationTaxonomy; }
  catch { throw new PermanentProcessingError('classifier taxonomy is invalid JSON'); }
  const validation = validateTaxonomy(taxonomy);
  if (!validation.ok) throw new PermanentProcessingError(`classifier taxonomy invalid: ${validation.errors.join('; ')}`);
  for (const label of taxonomy.labels) {
    if (!label.gmailLabelId) throw new PermanentProcessingError(`Gmail label mapping missing for ${label.id}`);
  }
  return taxonomy;
}

function validateResult(result: Pick<ClassificationResult,'labelId'|'configHash'>, config: ConfigSnapshot, taxonomy: ClassificationTaxonomy) {
  if (result.configHash !== config.hash) throw new PermanentProcessingError('classifier config hash mismatch');
  const label = taxonomy.labels.find((candidate) => candidate.id === result.labelId);
  if (!label || !label.enabled || !label.gmailLabelId) throw new PermanentProcessingError('classifier returned an unavailable label');
  return label;
}

function attemptAsResult(attempt: SuccessfulAttempt): ClassificationResult {
  return {
    labelId: attempt.labelId,
    probabilities: attempt.probabilities,
    confidence: attempt.confidence,
    provider: attempt.provider,
    model: attempt.model,
    usage: attempt.usage,
    configHash: attempt.configHash,
    idempotencyKey: 'persisted-attempt',
  };
}

export class MessageProcessor {
  private readonly gmail: GmailClient;
  private classifier: Classifier;
  private readonly repos: ProcessorRepositories;
  private governor: Governor;
  private readonly now: () => number;
  private readonly loadContext: (gmail: GmailClient, messageId: string) => Promise<MessageContext>;
  private readonly maxClassifierStateChars: number;

  constructor(options: ProcessorOptions) {
    this.gmail = options.gmail;
    this.classifier = options.classifier;
    this.repos = options.repos;
    this.governor = options.governor;
    this.now = options.now ?? Date.now;
    this.loadContext = options.loadContext ?? fetchMessageContext;
    this.maxClassifierStateChars = options.maxClassifierStateChars ?? 7600;
  }

  async processMessage(messageId: string): Promise<ProcessOutcome> {
    let message: GmailMessage;
    try {
      const installation = this.repos.installation.get();
      if (!installation?.processedLabelId) throw new PermanentProcessingError('installation is not ready');
      message = await this.gmail.getMessage(messageId);
      if (message.labelIds.includes(installation.processedLabelId)) return 'already_processed';

      const persisted = this.repos.attempt.getSuccessful(messageId);
      const config = persisted ? this.repos.config.get(persisted.configHash) : this.repos.config.getActive();
      if (!config) throw new PermanentProcessingError(persisted ? 'persisted classifier config is missing' : 'active classifier config is missing');
      const taxonomy = parseTaxonomy(config);

      let result: ClassificationResult;
      let context: MessageContext | null = null;
      if (persisted) {
        result = attemptAsResult(persisted);
      } else {
        const now=this.now();
        const decision = await this.governor.canStart(now);
        if (!decision.allowed) {
          this.repos.installation.patch?.({deferReason:decision.reason??null,deferUntil:decision.retryAt??null,lastPollStatus:'deferred'});
          return 'deferred';
        }
        const installationState=this.repos.installation.get();
        if(installationState?.deferReason||installationState?.deferUntil)this.repos.installation.patch?.({deferReason:null,deferUntil:null});
        context = await this.loadContext(this.gmail, messageId);
        const serializedState = serializeContextForClassifier(context, this.maxClassifierStateChars);
        result = await this.classifier.classify({
          gmailMessageId: messageId,
          serializedState,
          taxonomy,
          globalInstructions: config.globalInstructions,
          provider: config.provider,
          model: config.model,
          configHash: config.hash,
        });
        validateResult(result, config, taxonomy);
        const createdAt = this.now();
        this.repos.attempt.saveSuccess({
          messageId,
          configHash: config.hash,
          labelId: result.labelId,
          probabilities: result.probabilities,
          confidence: result.confidence,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          createdAt,
        });
        await this.governor.recordUsage({
          kind: 'classification',
          inputTokens: result.usage.input_tokens ?? null,
          costCents: result.usage.cost_cents ?? null,
          createdAt,
        });
      }

      const selected = validateResult(result, config, taxonomy);
      const appLabelIds = taxonomy.labels.map((label) => label.gmailLabelId!).filter(Boolean);
      const removeLabelIds = message.labelIds.filter((id) => appLabelIds.includes(id) && id !== selected.gmailLabelId);
      await this.gmail.modifyMessage(messageId, [selected.gmailLabelId!], removeLabelIds);
      await this.gmail.modifyMessage(messageId, [installation.processedLabelId], []);

      try {
        this.repos.audit.complete({
          messageId,
          threadId: message.threadId,
          labelId: result.labelId,
          configHash: config.hash,
          confidence: result.confidence,
          probabilities: result.probabilities,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          processedAt: this.now(),
        });
      } catch {
        this.repos.error?.add({stage:'audit',category:'audit_write',provider:'app',status:null,detail:'audit write failed',messageId,createdAt:this.now()});
        // Gmail's hidden processed marker is the durable completion boundary.
        // Audit loss is observable but must never cause paid reclassification.
      }
      return 'processed';
    } catch (error) {
      const reconnect=requiresGmailReconnect(error);
      if(reconnect)this.repos.installation.patch?.({needsReconnect:true});
      const disposition=error instanceof PermanentProcessingError?'permanent':classifyOperationalError(error);
      const details=describeOperationalError(error);
      const category=reconnect?'gmail_auth':details.provider==='classifier'?'classifier':isGmailQuotaError(error)?'gmail_quota':disposition;
      this.repos.error?.add({stage:'process_message',category,provider:details.provider,status:details.status,detail:details.detail,messageId,createdAt:this.now()});
      return disposition === 'transient' ? 'failed_transient' : 'failed_permanent';
    }
  }
}
