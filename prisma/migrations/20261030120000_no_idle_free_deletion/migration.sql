-- Free servers are no longer deleted for being idle: forget warnings already sent.
UPDATE "Server" SET "deletionWarnedAt" = NULL WHERE "plan" = 'FREE';
