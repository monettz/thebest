import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidate, isRemote } from '@/mock/sync';

/**
 * Global Realtime subscriptions to keep the whole POS synchronized across tabs and devices.
 * Automatically invalidates relevant React Query cache keys whenever changes occur.
 */
export function useSupabaseRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    if (!isRemote()) return;

    // Any change made elsewhere: mark the in-memory copy stale first, then refresh the screens.
    const channel = supabase
      .channel('pos-realtime-sync')
      // Products, stock and transfers
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['products'] });
        void qc.invalidateQueries({ queryKey: ['pos-products'] });
        void qc.invalidateQueries({ queryKey: ['shop-dashboard'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_units' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['products'] });
        void qc.invalidateQueries({ queryKey: ['pos-products'] });
        void qc.invalidateQueries({ queryKey: ['store-imeis'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['products'] });
        void qc.invalidateQueries({ queryKey: ['pos-products'] });
        void qc.invalidateQueries({ queryKey: ['movements'] });
        void qc.invalidateQueries({ queryKey: ['store-feed'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['products'] });
        void qc.invalidateQueries({ queryKey: ['pos-products'] });
        void qc.invalidateQueries({ queryKey: ['store-feed'] });
      })
      // Sales and Payments
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['sales'] });
        void qc.invalidateQueries({ queryKey: ['sale'] });
        void qc.invalidateQueries({ queryKey: ['debts'] });
        void qc.invalidateQueries({ queryKey: ['shop-dashboard'] });
        void qc.invalidateQueries({ queryKey: ['close-day'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['debts'] });
        void qc.invalidateQueries({ queryKey: ['sales'] });
        void qc.invalidateQueries({ queryKey: ['sale'] });
        void qc.invalidateQueries({ queryKey: ['close-day'] });
        void qc.invalidateQueries({ queryKey: ['shop-dashboard'] });
      })
      // Customers
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['customers'] });
        void qc.invalidateQueries({ queryKey: ['debts'] });
      })
      // Expenses
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['expenses'] });
        void qc.invalidateQueries({ queryKey: ['close-day'] });
        void qc.invalidateQueries({ queryKey: ['shop-dashboard'] });
      })
      // Cash Closings
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_closings' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['close-day'] });
        void qc.invalidateQueries({ queryKey: ['shop-dashboard'] });
      })
      // Stock takes
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_takes' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['stock-takes'] });
        void qc.invalidateQueries({ queryKey: ['products'] });
      })
      // Suppliers & Purchases
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['suppliers'] });
        void qc.invalidateQueries({ queryKey: ['supplier-list'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases' }, () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ['suppliers'] });
        void qc.invalidateQueries({ queryKey: ['store-feed'] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}

