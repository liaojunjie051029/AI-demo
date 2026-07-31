-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Message_userId_idx" ON "Message"("userId");
