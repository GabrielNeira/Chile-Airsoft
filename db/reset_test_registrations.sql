-- =========================================================================
-- Script para limpiar las inscripciones de prueba
-- Ejecuta esto en el SQL Editor para volver a intentar el pago
-- =========================================================================

DELETE FROM public.event_paid_registrations;
DELETE FROM public.payment_transactions;
DELETE FROM public.payment_orders;
