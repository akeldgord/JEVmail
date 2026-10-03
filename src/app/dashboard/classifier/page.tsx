import { getRuntimeRepositories } from '../../../db/runtime.ts';
import { ClassifierConsole } from '../../../ui/components/classifier-console.tsx';
import { ClassifierSettingsForm } from '../../../ui/components/classifier-settings-form.tsx';

export default function ClassifierPage(){
  const active=getRuntimeRepositories().config.getActive();
  if(!active)return <p>No active classifier configuration.</p>;
  return <><h1>Classifier</h1><ClassifierSettingsForm model={active.model} instructions={active.globalInstructions} hash={active.hash}/><ClassifierConsole/></>;
}
