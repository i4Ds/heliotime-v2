'use client';

import { getQueryClient } from '@/api/client';
import { QueryClientProvider } from '@tanstack/react-query';
import type * as React from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
