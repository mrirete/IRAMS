
-- Enforce Strict Access Control
-- Only allow new Auth Users if they match an existing Contact by email.

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
DECLARE
  linked_contact_id UUID;
  user_role text[];
  contact_username text;
BEGIN
  -- 1. Try to find a pre-seeded contact by email
  SELECT id, roles INTO linked_contact_id, user_role FROM public.contacts WHERE email = new.email;
  
  -- STRICT CHECK: If no contact found, BLOCK the user creation
  IF linked_contact_id IS NULL THEN
    RAISE EXCEPTION 'Access Denied: No matching contact record found for %. Please contact an administrator.', new.email;
  END IF;

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
    to_jsonb(user_role) -- Use the actual role from Contact
  );
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
