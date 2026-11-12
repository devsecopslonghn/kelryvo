CREATE TABLE sf_fixture (id NUMBER);
ALTER TABLE sf_fixture ADD label VARCHAR2(40);
CREATE INDEX sf_fixture_idx ON sf_fixture(id);
CREATE VIEW sf_fixture_v AS SELECT id FROM sf_fixture;
