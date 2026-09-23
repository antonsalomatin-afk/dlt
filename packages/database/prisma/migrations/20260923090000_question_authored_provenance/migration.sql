-- Enforce the accepted content decision: a question may only reach the VERIFIED state that
-- learner-facing delivery requires when it is original in-house work carrying a public legal
-- citation. Draft and rejected rows are deliberately unconstrained so authoring and review can
-- proceed before provenance is complete, and so development fixtures remain storable.
ALTER TABLE "Question"
    ADD CONSTRAINT "Question_verified_requires_original" CHECK (
        "verificationStatus" <> 'VERIFIED' OR "sourceType" = 'ORIGINAL'
    ),
    ADD CONSTRAINT "Question_verified_requires_legal_citation" CHECK (
        "verificationStatus" <> 'VERIFIED' OR BTRIM(COALESCE("legalCitation", '')) <> ''
    );
