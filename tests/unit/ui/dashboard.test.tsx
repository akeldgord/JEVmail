// @vitest-environment jsdom
import { describe,it,expect } from 'vitest';
import { render,screen } from '@testing-library/react';
import { StatusCard } from '../../../src/ui/components/status-card.tsx';
import { ProbabilityList } from '../../../src/ui/components/probability-list.tsx';

describe('dashboard components',()=>{
  it('renders status metrics',()=>{render(<StatusCard label="Classified today" value={12}/>);expect(screen.getByText('Classified today')).toBeTruthy();expect(screen.getByText('12')).toBeTruthy();});
  it('renders probability labels',()=>{render(<ProbabilityList probabilities={{reply_needed:.8,indeterminate:.2}}/>);expect(screen.getByText('reply_needed')).toBeTruthy();expect(screen.getByText('80%')).toBeTruthy();});
});
