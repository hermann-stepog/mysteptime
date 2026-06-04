
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('pending', 'collaborator', 'logistics_operator');
CREATE TYPE public.embarkation_status AS ENUM ('scheduled','confirmed','boarded','disembarked','cancelled','transferred');
CREATE TYPE public.transport_type AS ENUM ('carro','van','voo','onibus');
CREATE TYPE public.transport_status AS ENUM ('solicitado','confirmado','em_transito','concluido','cancelado');
CREATE TYPE public.timesheet_status AS ENUM ('draft','submitted','approved','rejected');
CREATE TYPE public.rdo_status AS ENUM ('draft','submitted','approved');
CREATE TYPE public.doc_status AS ENUM ('valid','expiring','expired');
CREATE TYPE public.approval_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.cost_type AS ENUM ('transporte_pessoal','passagem_aerea','hospedagem','pre_embarque','embarque_cancelado','embarque_transferido','servico_externo','demandas_diversas');
CREATE TYPE public.billing_type AS ENUM ('com_cobranca','sem_cobranca');
CREATE TYPE public.payroll_status AS ENUM ('pendente','enviado_dp','confirmado_dp');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  matricula TEXT,
  phone TEXT,
  embarkation_blocked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- ============ HELPERS ============
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_operator(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'logistics_operator')
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- new user trigger: create profile + assign role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role public.app_role := 'pending';
BEGIN
  IF lower(NEW.email) = 'hermann.siqueira@step-og.com' THEN
    v_role := 'logistics_operator';
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ CADASTROS ============
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, code)
);

CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  vendor_type TEXT,
  contact TEXT,
  email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.approvers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  email TEXT NOT NULL,
  department TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ OPERACIONAL ============
CREATE TABLE public.embarkations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id),
  project_id UUID REFERENCES public.projects(id),
  embark_date DATE NOT NULL,
  disembark_date DATE,
  status public.embarkation_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  pre_embark_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.transport_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  embarkation_id UUID REFERENCES public.embarkations(id) ON DELETE SET NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  transport_type public.transport_type NOT NULL,
  vendor_id UUID REFERENCES public.vendors(id),
  driver_name TEXT,
  vehicle TEXT,
  status public.transport_status NOT NULL DEFAULT 'solicitado',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hotel_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  embarkation_id UUID REFERENCES public.embarkations(id) ON DELETE SET NULL,
  hotel_name TEXT NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  vendor_id UUID REFERENCES public.vendors(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  issued_at DATE,
  expires_at DATE NOT NULL,
  file_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.rdo_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id),
  report_date DATE NOT NULL,
  activity TEXT NOT NULL,
  hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  observations TEXT,
  status public.rdo_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id),
  work_date DATE NOT NULL,
  activity_type TEXT NOT NULL,
  hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  status public.timesheet_status NOT NULL DEFAULT 'draft',
  reject_comment TEXT,
  validated_by UUID REFERENCES auth.users(id),
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cost_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id),
  project_id UUID REFERENCES public.projects(id),
  cost_type public.cost_type NOT NULL,
  vendor_id UUID REFERENCES public.vendors(id),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  period_start DATE,
  period_end DATE,
  billing public.billing_type NOT NULL DEFAULT 'com_cobranca',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  approver_id UUID NOT NULL REFERENCES public.approvers(id),
  collaborator_id UUID REFERENCES public.profiles(id),
  payload JSONB,
  status public.approval_status NOT NULL DEFAULT 'pending',
  comment TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.payroll_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cycle_start DATE NOT NULL,
  cycle_end DATE NOT NULL,
  days_onboard INT NOT NULL DEFAULT 0,
  total_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  sobreaviso_days INT NOT NULL DEFAULT 0,
  status public.payroll_status NOT NULL DEFAULT 'pendente',
  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ TRIGGERS updated_at ============
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_embark_updated BEFORE UPDATE ON public.embarkations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_transport_updated BEFORE UPDATE ON public.transport_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_rdo_updated BEFORE UPDATE ON public.rdo_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_timesheet_updated BEFORE UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ GRANTS ============
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.profiles, public.user_roles, public.clients, public.projects, public.vendors, public.approvers,
  public.embarkations, public.transport_requests, public.hotel_bookings, public.documents,
  public.rdo_entries, public.timesheets, public.cost_logs, public.notifications,
  public.approval_requests, public.payroll_summaries TO authenticated;
GRANT ALL ON
  public.profiles, public.user_roles, public.clients, public.projects, public.vendors, public.approvers,
  public.embarkations, public.transport_requests, public.hotel_bookings, public.documents,
  public.rdo_entries, public.timesheets, public.cost_logs, public.notifications,
  public.approval_requests, public.payroll_summaries TO service_role;

-- ============ RLS ============
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embarkations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rdo_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_summaries ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "users view own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "operators insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()) OR id = auth.uid());

-- user_roles: read own; operators full
CREATE POLICY "view own role" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "operators manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- cadastros (read all authenticated, write operators)
CREATE POLICY "read clients" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops manage clients" ON public.clients FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "read projects" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops manage projects" ON public.projects FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "read vendors" ON public.vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops manage vendors" ON public.vendors FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "read approvers" ON public.approvers FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops manage approvers" ON public.approvers FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- embarkations
CREATE POLICY "view own embark" ON public.embarkations FOR SELECT TO authenticated USING (collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "ops manage embark" ON public.embarkations FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- transport
CREATE POLICY "view own transport" ON public.transport_requests FOR SELECT TO authenticated USING (collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "ops manage transport" ON public.transport_requests FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- hotel
CREATE POLICY "view own hotel" ON public.hotel_bookings FOR SELECT TO authenticated USING (collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "ops manage hotel" ON public.hotel_bookings FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- documents
CREATE POLICY "view own docs" ON public.documents FOR SELECT TO authenticated USING (collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "ops manage docs" ON public.documents FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "collab insert own doc" ON public.documents FOR INSERT TO authenticated WITH CHECK (collaborator_id = auth.uid());

-- RDO
CREATE POLICY "view own rdo" ON public.rdo_entries FOR SELECT TO authenticated USING (collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "collab insert rdo" ON public.rdo_entries FOR INSERT TO authenticated WITH CHECK (collaborator_id = auth.uid());
CREATE POLICY "collab update own draft rdo" ON public.rdo_entries FOR UPDATE TO authenticated USING ((collaborator_id = auth.uid() AND status = 'draft') OR public.is_operator(auth.uid()));
CREATE POLICY "ops delete rdo" ON public.rdo_entries FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- timesheets
CREATE POLICY "view own ts" ON public.timesheets FOR SELECT TO authenticated USING (collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "collab insert ts" ON public.timesheets FOR INSERT TO authenticated WITH CHECK (collaborator_id = auth.uid());
CREATE POLICY "collab update own draft ts" ON public.timesheets FOR UPDATE TO authenticated USING ((collaborator_id = auth.uid() AND status IN ('draft','submitted')) OR public.is_operator(auth.uid())) WITH CHECK (collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "ops delete ts" ON public.timesheets FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- cost logs: operators only
CREATE POLICY "ops manage costs" ON public.cost_logs FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- notifications
CREATE POLICY "view own notifs" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "update own notifs" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "ops insert notifs" ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "ops delete notifs" ON public.notifications FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- approval requests
CREATE POLICY "view approvals" ON public.approval_requests FOR SELECT TO authenticated USING (requested_by = auth.uid() OR collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "ops manage approvals" ON public.approval_requests FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- payroll
CREATE POLICY "view own payroll" ON public.payroll_summaries FOR SELECT TO authenticated USING (collaborator_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE POLICY "ops manage payroll" ON public.payroll_summaries FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- ============ SEEDS ============
INSERT INTO public.clients (name) VALUES ('SBM'),('PRIO'),('YINSON'),('STEP') ON CONFLICT DO NOTHING;
