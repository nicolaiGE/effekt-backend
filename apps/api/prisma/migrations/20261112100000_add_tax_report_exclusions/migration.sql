-- Tax units an admin has left out of the year's report to Skatteetaten (Reports › Tax deduction),
-- with the reason: for example a number Altinn rejected for a donor we can't reach. Additive: a
-- new table only.

-- CreateTable
CREATE TABLE `Tax_report_exclusions` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Tax_unit_ID` INTEGER NOT NULL,
    `Year` INTEGER NOT NULL,
    `Reason` VARCHAR(500) NOT NULL,
    `Created_by` VARCHAR(255) NOT NULL,
    `Created` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `Tax_unit_ID_Year_UNIQUE`(`Tax_unit_ID`, `Year`),
    INDEX `Year_idx`(`Year`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Tax_report_exclusions` ADD CONSTRAINT `fk_Tax_report_exclusions_to_Tax_unit` FOREIGN KEY (`Tax_unit_ID`) REFERENCES `Tax_unit`(`ID`) ON DELETE CASCADE ON UPDATE CASCADE;
