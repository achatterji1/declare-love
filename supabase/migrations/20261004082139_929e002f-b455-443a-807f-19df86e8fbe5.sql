CREATE TABLE public.declare_wallets (
  id UUID PRIMARY KEY,
  chips INTEGER NOT NULL DEFAULT 0,
  claim_available_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 0,
  applied_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.declare_wallets TO service_role;
ALTER TABLE public.declare_wallets ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_declare_wallets_updated_at BEFORE UPDATE ON public.declare_wallets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();