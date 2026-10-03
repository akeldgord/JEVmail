// @vitest-environment jsdom
import { describe,it,expect } from 'vitest';
import { fireEvent,render,screen } from '@testing-library/react';
import { StatusCard } from '../../../src/ui/components/status-card.tsx';
import { ProbabilityList } from '../../../src/ui/components/probability-list.tsx';
import { RateLimitBanner, backlogStatusText } from '../../../src/ui/components/rate-limit-banner.tsx';
import { TaxonomyEditor } from '../../../src/ui/components/taxonomy-editor.tsx';
import { ClassifierSettingsForm } from '../../../src/ui/components/classifier-settings-form.tsx';
import { DEFAULT_TAXONOMY } from '../../../src/domain/defaults.ts';
import { MAX_GLOBAL_INSTRUCTIONS_CHARS } from '../../../src/classifier/prompt-builder.ts';

describe('dashboard components',()=>{
  it('renders status metrics',()=>{
    render(<StatusCard label="Classified today" value={12}/>);
    expect(screen.getByText('Classified today')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('renders probability labels',()=>{
    render(<ProbabilityList probabilities={{reply_needed:.8,indeterminate:.2}}/>);
    expect(screen.getByText('reply_needed')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
  });

  it('renders deferred quota state with reset time',()=>{
    const deferUntil=new Date('2026-10-02T02:34:00Z').getTime();
    const quota={deferred:true,nearLimit:true,reason:'per_hour',deferUntil,windows:[
      {key:'minute',used:30,cap:30},
      {key:'hour',used:293,cap:300},
      {key:'day',used:400,cap:2000}
    ]};
    render(<RateLimitBanner quota={quota}/>);
    expect(screen.getByTestId('rate-limit-banner')).toBeTruthy();
    expect(screen.getByText('Rate limited')).toBeTruthy();
    expect(screen.getByText(/293\/300/)).toBeTruthy();
    expect(backlogStatusText('deferred',quota)).toMatch(/^waiting \(hourly limit, resumes /);
  });
  it('renders add-category controls budget meter and delete only for custom categories',()=>{
    const taxonomy=structuredClone(DEFAULT_TAXONOMY);
    for(const label of taxonomy.labels)label.gmailLabelId=`G_${label.id}`;
    taxonomy.labels.push({id:'custom_ui',displayName:'Custom UI',description:'x',guidance:'x',enabled:false,priority:500,semanticRole:'standard',gmailLabelName:'JEVmail/Custom UI',gmailLabelId:'G_custom_ui'});
    const gmailLabels=taxonomy.labels.map(label=>({id:label.gmailLabelId!,name:label.gmailLabelName}));
    render(<TaxonomyEditor taxonomy={taxonomy} gmailLabels={gmailLabels} budget={{criteriaJsonChars:1600,enabledLabelCount:DEFAULT_TAXONOMY.labels.length}}/>);
    expect(screen.getByRole('heading',{name:'Add category'})).toBeTruthy();
    expect(screen.getAllByText(/Prompt budget:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delete category')).toHaveLength(1);
  });

  it('shows live instruction budget and warns above the save limit',()=>{
    render(<ClassifierSettingsForm model="jev-1.13.0" instructions="abc" hash="hash"/>);
    expect(screen.getByText(/3 \/ .* chars/)).toBeTruthy();
    const textarea=screen.getByRole('textbox',{name:/Global handling instructions/i});
    fireEvent.change(textarea,{target:{value:'x'.repeat(MAX_GLOBAL_INSTRUCTIONS_CHARS+1)}});
    expect(screen.getByText(/shorten before saving/i)).toBeTruthy();
  });
});
