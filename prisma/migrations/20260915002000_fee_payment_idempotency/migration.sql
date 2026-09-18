ALTER TABLE "fee_payments"
  ADD COLUMN "request_key" UUID,
  ADD COLUMN "request_fingerprint" TEXT;

CREATE UNIQUE INDEX "fee_payment_request_key_unique" ON "fee_payments"("request_key");
