// @vitest-environment jsdom
import { describe,it,expect } from 'vitest';
import { render,screen } from '@testing-library/react';
import { StatusCard } from '../../../src/ui/components/status-card.tsx';
import { ProbabilityList } from '../../../src/ui/components/probability-list.tsx';
import { RateLimitBanner, backlogStatusText } from '../../../src/ui/components/rate-limit-banner.tsx';

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
});
