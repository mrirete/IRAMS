
-- 1. Robust Trigger Update (Case Insensitive Matching)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
DECLARE
  linked_contact_id UUID;
  user_role text[];
  contact_username text;
BEGIN
  -- 1. Try to find a pre-seeded contact by email (CASE INSENSITIVE)
  SELECT id, roles INTO linked_contact_id, user_role 
  FROM public.contacts 
  WHERE LOWER(email) = LOWER(new.email);
  
  -- STRICT CHECK: If no contact found, BLOCK the user creation
  IF linked_contact_id IS NULL THEN
    RAISE EXCEPTION 'Access Denied: No matching contact record found for %. (Checked case-insensitive)', new.email;
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
    to_jsonb(user_role)
  );
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Clean up Jsax (Again)
DELETE FROM auth.users WHERE email ILIKE 'jsax@%';
DELETE FROM public.users WHERE email ILIKE 'jsax@%';

-- 3. Ensure Contact Email is consistent (Optional, but good practice)
-- We set it to lowercase to match typical Auth behavior
UPDATE public.contacts 
SET email = LOWER(email) 
WHERE name ILIKE '%Jude%' OR email ILIKE 'jsax@%';
