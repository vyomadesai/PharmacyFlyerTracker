IF NOT EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_Campaign WHERE CampaignName = 'Sample Pharmacy Flyer Campaign')
BEGIN
    INSERT INTO dbo.PharmacyFlyer_Campaign (CampaignName, Description, StartDate, EndDate, IsActive, CreatedBy)
    VALUES ('Sample Pharmacy Flyer Campaign', 'Default campaign for testing flyer delivery app.', CAST(GETDATE() AS DATE), DATEADD(day, 30, CAST(GETDATE() AS DATE)), 1, NULL);
END;
GO
