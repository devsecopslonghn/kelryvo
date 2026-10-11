-- Install manually in the dedicated execution owner. Do not execute from the API or application
-- writer owner. The execution owner needs direct EXECUTE on SYS.DBMS_LOCK; the application
-- writer receives EXECUTE only on this package, never on SYS.DBMS_LOCK or its lock tables.
-- After installation, grant EXECUTE on this package only to the exact restricted writer principal.
-- Do not grant it to PUBLIC/roles; the writer principal must have no direct or inherited
-- SYS.DBMS_LOCK privileges and no access to SYS.DBMS_LOCK_ALLOCATED.
CREATE OR REPLACE PACKAGE sf_target_mutex AUTHID DEFINER AS
  PROCEDURE acquire_lock(p_lock_name IN VARCHAR2, p_nonce IN VARCHAR2, p_result OUT NUMBER);
  PROCEDURE current_lock(p_lock_name IN VARCHAR2, p_nonce IN VARCHAR2, p_result OUT NUMBER);
  PROCEDURE release_lock(p_lock_name IN VARCHAR2, p_nonce IN VARCHAR2, p_result OUT NUMBER);
END sf_target_mutex;
/

CREATE OR REPLACE PACKAGE BODY sf_target_mutex AS
  g_lock_handle VARCHAR2(128);
  g_lock_name VARCHAR2(128);
  g_nonce VARCHAR2(64);

  PROCEDURE acquire_lock(p_lock_name IN VARCHAR2, p_nonce IN VARCHAR2, p_result OUT NUMBER) AS
    l_handle VARCHAR2(128);
    l_result NUMBER;
  BEGIN
    IF g_lock_handle IS NOT NULL OR g_lock_name IS NOT NULL OR g_nonce IS NOT NULL
       OR p_lock_name IS NULL OR NOT REGEXP_LIKE(p_lock_name, '^SF_SCHEMAFORGE_TARGET_[a-f0-9]{64}$', 'c')
       OR p_nonce IS NULL OR NOT REGEXP_LIKE(p_nonce, '^[a-f0-9]{64}$', 'c') THEN
      p_result := 3;
      RETURN;
    END IF;

    DBMS_LOCK.ALLOCATE_UNIQUE_AUTONOMOUS(p_lock_name, l_handle);
    l_result := DBMS_LOCK.REQUEST(l_handle, DBMS_LOCK.X_MODE, 0, FALSE);
    p_result := l_result;
    IF l_result = 0 THEN
      g_lock_handle := l_handle;
      g_lock_name := p_lock_name;
      g_nonce := p_nonce;
    END IF;
    -- In particular, REQUEST=4 is returned unchanged. Do not adopt its existing lock.
  END acquire_lock;

  PROCEDURE current_lock(p_lock_name IN VARCHAR2, p_nonce IN VARCHAR2, p_result OUT NUMBER) AS
  BEGIN
    IF g_lock_handle IS NULL OR g_lock_name IS NULL OR g_nonce IS NULL THEN
      p_result := 4;
      RETURN;
    END IF;
    IF p_lock_name IS NULL OR p_nonce IS NULL OR p_lock_name <> g_lock_name OR p_nonce <> g_nonce THEN
      p_result := 3;
      RETURN;
    END IF;
    -- CONVERT checks this exact existing handle; REQUEST here could reacquire after a reset.
    p_result := DBMS_LOCK.CONVERT(g_lock_handle, DBMS_LOCK.X_MODE, 0);
  END current_lock;

  PROCEDURE release_lock(p_lock_name IN VARCHAR2, p_nonce IN VARCHAR2, p_result OUT NUMBER) AS
    l_handle VARCHAR2(128);
  BEGIN
    IF g_lock_handle IS NULL OR g_lock_name IS NULL OR g_nonce IS NULL THEN
      p_result := 4;
      RETURN;
    END IF;
    IF p_lock_name IS NULL OR p_nonce IS NULL OR p_lock_name <> g_lock_name OR p_nonce <> g_nonce THEN
      p_result := 3;
      RETURN;
    END IF;
    l_handle := g_lock_handle;
    -- Retire package authority after this single attempt, even if release reports uncertainty.
    g_lock_handle := NULL;
    g_lock_name := NULL;
    g_nonce := NULL;
    p_result := DBMS_LOCK.RELEASE(l_handle);
  END release_lock;
END sf_target_mutex;
/
