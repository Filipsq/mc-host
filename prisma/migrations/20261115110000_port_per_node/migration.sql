-- Each machine has the whole port range: a port is unique on its machine only.
DROP INDEX "public"."Server_port_key";
CREATE UNIQUE INDEX "Server_node_port_key" ON "public"."Server"("node", "port");
