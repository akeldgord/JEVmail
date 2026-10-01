import type { ReactNode } from 'react';
export const metadata = { title: 'JEVmail', description: 'Handling-first Gmail triage' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{fontFamily:'system-ui',margin:0,background:'#f7f7f8',color:'#18181b'}}>{children}</body></html>;
}
