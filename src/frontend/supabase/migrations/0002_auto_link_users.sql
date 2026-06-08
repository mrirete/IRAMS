-- Trigger to automatically create a public.users entry when a new auth.users entry is created.
-- It attempts to link to an existing Contact by matching Email.

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
DECLARE
  linked_contact_id UUID;
  user_role text[];
  contact_username text;
BEGIN
  -- 1. Try to find a pre-seeded contact by email
  SELECT id, roles INTO linked_contact_id, user_role FROM public.contacts WHERE email = new.email;
  
  -- 2. Derive username from email (everything before @)
  contact_username := split_part(new.email, '@', 1);

  -- 3. Insert into public.users
  INSERT INTO public.users (id, username, email, contact_id, status, roles)
  VALUES (
    new.id, 
    contact_username, 
    new.email, 
    linked_contact_id, 
    'active', 
    to_jsonb(COALESCE(user_role, ARRAY['TECHNICIAN'])) -- Cast Postgres Array to JSONB
  );
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
