-- Reminders of the missing tax unit notice (Reports › Tax deduction): how many a donor who was
-- sent the notice has had since, and the last one. Additive: new columns with defaults.

-- AlterTable
ALTER TABLE `Tax_unit_notices` ADD COLUMN `Reminders` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `Last_reminded` DATETIME(0) NULL,
    ADD COLUMN `Last_reminded_by` VARCHAR(255) NULL;
