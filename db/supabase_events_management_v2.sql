-- supabase_events_management_v2.sql
-- 1. Añadir columna price a public.events
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS price integer DEFAULT 25000;

-- 2. Asegurarnos que la tabla de registros acepta registros manuales
-- Primero vemos si el enum registration_status tiene 'manual_unpaid'.
ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'manual_unpaid';

-- 3. Quitar la restricción NOT NULL de los IDs de pago de MercadoPago
ALTER TABLE public.event_paid_registrations ALTER COLUMN payment_order_id DROP NOT NULL;
ALTER TABLE public.event_paid_registrations ALTER COLUMN payment_transaction_id DROP NOT NULL;
