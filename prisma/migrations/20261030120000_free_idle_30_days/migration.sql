-- Free servers are now deleted after 30 idle days, not 7: forget warnings sent under the old rule.
UPDATE "Server" SET "deletionWarnedAt" = NULL WHERE "plan" = 'FREE';
