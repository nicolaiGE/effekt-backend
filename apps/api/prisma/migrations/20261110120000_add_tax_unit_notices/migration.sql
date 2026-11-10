-- The missing tax unit notice per donor and gift year (Reports › Tax deduction): who an admin
-- has left out of it, and who has been sent it, so the next sending skips them. Additive: a new
-- table only.

-- CreateTable
CREATE TABLE `Tax_unit_notices` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Donor_ID` INTEGER NOT NULL,
    `Year` INTEGER NOT NULL,
    `Status` VARCHAR(16) NOT NULL,
    `Updated_by` VARCHAR(255) NOT NULL,
    `Updated` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `Donor_ID_Year_UNIQUE`(`Donor_ID`, `Year`),
    INDEX `Year_Status_idx`(`Year`, `Status`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Tax_unit_notices` ADD CONSTRAINT `fk_Tax_unit_notices_to_Donors` FOREIGN KEY (`Donor_ID`) REFERENCES `Donors`(`ID`) ON DELETE CASCADE ON UPDATE CASCADE;
