-- CreateEnum
CREATE TYPE "CiiRating" AS ENUM ('A', 'B', 'C', 'D', 'E');

-- AlterTable
ALTER TABLE "Voyage" ADD COLUMN     "ciiAttained" DOUBLE PRECISION,
ADD COLUMN     "ciiRating" "CiiRating";
