-- The XML files made for Skatteetaten (Reports › Tax deduction): who made each, when, its totals,
-- and which one was sent; and per tax unit of ours the amount in it, so gifts that change after
-- the report can be listed for a correction (RF-1310). No national IDs: tax units by ID.
-- Additive: new tables only.

-- CreateTable
CREATE TABLE `Tax_reports` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Year` INTEGER NOT NULL,
    `Units` INTEGER NOT NULL,
    `Sum` DECIMAL(15, 2) NOT NULL,
    `Giverportal_sum` DECIMAL(15, 2) NOT NULL,
    `Left_out` INTEGER NOT NULL DEFAULT 0,
    `Created_by` VARCHAR(255) NOT NULL,
    `Created` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `Submitted` DATETIME(0) NULL,
    `Submitted_by` VARCHAR(255) NULL,

    INDEX `Year_idx`(`Year`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tax_report_units` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Tax_report_ID` INTEGER NOT NULL,
    `Tax_unit_ID` INTEGER NOT NULL,
    `Amount` DECIMAL(15, 2) NOT NULL,

    INDEX `Tax_report_ID_idx`(`Tax_report_ID`),
    INDEX `Tax_unit_ID_idx`(`Tax_unit_ID`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Tax_report_units` ADD CONSTRAINT `fk_Tax_report_units_to_Tax_reports` FOREIGN KEY (`Tax_report_ID`) REFERENCES `Tax_reports`(`ID`) ON DELETE CASCADE ON UPDATE CASCADE;
