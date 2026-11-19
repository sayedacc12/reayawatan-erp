-- أداة تضخيم البيانات لاختبار الأداء (تُستخدم على نسخة اختبار معزولة فقط، أبدًا على الإنتاج)
-- lt_clone(tables, org_slug, g_from, g_to): تنسخ صفوف جمعية في مجموعة جداول مترابطة (g_to - g_from + 1) مرة.
-- المعرّف الجديد = md5(المعرّف القديم || g)، وكل مفتاح أجنبي يشير لجدول داخل المجموعة يُحوَّل بالطريقة نفسها،
-- فتبقى العلاقات (رأس/أسطر، طلب/إجراءات) سليمة دون جداول ربط.
CREATE OR REPLACE FUNCTION lt_clone(tbls text[], org_slug text, g_from int, g_to int) RETURNS void AS $$
DECLARE
  org uuid; t text; c record; cols text; exprs text; filter text; has_org boolean;
  fk record; uq_cols text[]; n bigint;
BEGIN
  SELECT id INTO org FROM organizations WHERE slug = org_slug;
  IF org IS NULL THEN RAISE EXCEPTION 'org % not found', org_slug; END IF;
  CREATE TEMP TABLE IF NOT EXISTS lt_src(tbl text, id uuid);
  TRUNCATE lt_src;
  -- 1) تثبيت المعرفات الأصلية قبل أي إدراج
  FOREACH t IN ARRAY tbls LOOP
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=t AND column_name='organization_id') INTO has_org;
    IF has_org THEN
      EXECUTE format('INSERT INTO lt_src SELECT %L, id FROM %I WHERE organization_id=%L', t, t, org);
    ELSE
      -- جدول فرعي بلا organization_id: صفوفه التابعة لأب داخل المجموعة
      filter := NULL;
      FOR fk IN SELECT a.attname col, cl2.relname ref FROM pg_constraint k
          JOIN pg_class cl ON cl.oid=k.conrelid JOIN pg_class cl2 ON cl2.oid=k.confrelid
          JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=k.conkey[1]
          WHERE k.contype='f' AND cl.relname=t AND cl2.relname = ANY(tbls) AND cl2.relname<>t LOOP
        filter := coalesce(filter || ' OR ', '') || format('%I IN (SELECT id FROM lt_src WHERE tbl=%L)', fk.col, fk.ref);
      END LOOP;
      IF filter IS NULL THEN RAISE EXCEPTION 'no parent for %', t; END IF;
      EXECUTE format('INSERT INTO lt_src SELECT %L, id FROM %I WHERE %s', t, t, filter);
    END IF;
  END LOOP;
  -- 2) النسخ
  FOREACH t IN ARRAY tbls LOOP
    -- لكل فهرس فريد نغيّر عمودًا واحدًا فقط حتى لا تفسد القيم ذات المعنى (مثل نوع السند):
    -- الرقم التسلسلي إن وُجد، وإلا أطول عمود نصي، وإلا عمود uuid (يُفرَّغ)
    SELECT array_agg(DISTINCT pick) INTO uq_cols FROM (
      SELECT (SELECT a.attname FROM pg_attribute a JOIN information_schema.columns ic ON ic.table_name=t AND ic.column_name=a.attname
              WHERE a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey) AND a.attname <> 'organization_id'
              ORDER BY (ic.data_type IN ('integer','bigint')) DESC, (ic.data_type IN ('character varying','text')) DESC, ic.character_maximum_length DESC NULLS FIRST
              LIMIT 1) AS pick
      FROM pg_index i JOIN pg_class cl ON cl.oid=i.indrelid WHERE cl.relname=t AND i.indisunique AND NOT i.indisprimary) x;
    cols := ''; exprs := '';
    FOR c IN SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name=t AND table_schema='public' ORDER BY ordinal_position LOOP
      cols := cols || format('%I,', c.column_name);
      SELECT cl2.relname INTO fk FROM pg_constraint k JOIN pg_class cl ON cl.oid=k.conrelid JOIN pg_class cl2 ON cl2.oid=k.confrelid
        JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=k.conkey[1]
        WHERE k.contype='f' AND cl.relname=t AND a.attname=c.column_name LIMIT 1;
      IF c.column_name='id' THEN
        exprs := exprs || 'md5(s.id::text||g)::uuid,';
      ELSIF FOUND AND fk.relname = ANY(tbls) THEN
        exprs := exprs || format('CASE WHEN s.%1$I IS NULL THEN NULL ELSE md5(s.%1$I::text||g)::uuid END,', c.column_name);
      ELSIF c.column_name = ANY(coalesce(uq_cols,'{}')) OR (c.data_type IN ('integer','bigint') AND c.column_name ~ '(_no|serial)$') THEN
        IF c.data_type IN ('integer','bigint') THEN exprs := exprs || format('s.%I + g*1000,', c.column_name);
        ELSIF c.data_type IN ('character varying','text') THEN exprs := exprs || format('CASE WHEN s.%1$I IS NULL THEN NULL ELSE s.%1$I||''-''||g END,', c.column_name);
        ELSIF c.data_type='uuid' AND c.is_nullable='YES' THEN exprs := exprs || 'NULL,';
        ELSE exprs := exprs || format('s.%I,', c.column_name); END IF;
      ELSIF c.column_name='created_at' THEN
        exprs := exprs || 's.created_at - (g % 1000) * interval ''1 day'',';
      ELSE
        exprs := exprs || format('s.%I,', c.column_name);
      END IF;
    END LOOP;
    EXECUTE format('INSERT INTO %I (%s) SELECT %s FROM %I s CROSS JOIN generate_series(%s,%s) g WHERE s.id IN (SELECT id FROM lt_src WHERE tbl=%L)',
      t, rtrim(cols, ','), rtrim(exprs, ','), t, g_from, g_to, t);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '% +% rows', t, n;
  END LOOP;
END $$ LANGUAGE plpgsql;
