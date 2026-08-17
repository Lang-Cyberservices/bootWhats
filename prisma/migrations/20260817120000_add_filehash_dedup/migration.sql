-- AlterTable
ALTER TABLE `media_hashes` ADD COLUMN `fileHash` VARCHAR(128) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `media_hashes_fileHash_key` ON `media_hashes`(`fileHash`);

-- AlterTable
ALTER TABLE `media_analysis_jobs` ADD COLUMN `fileHash` VARCHAR(128) NULL;

-- CreateIndex
CREATE INDEX `media_analysis_jobs_fileHash_status_idx` ON `media_analysis_jobs`(`fileHash`, `status`);
