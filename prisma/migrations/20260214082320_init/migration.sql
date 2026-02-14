-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "oldSiteUrl" TEXT NOT NULL,
    "newSiteUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);
