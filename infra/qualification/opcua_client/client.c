#include <open62541/client.h>
#include <open62541/client_config_default.h>
#include <stdio.h>

int main(void) {
    UA_Client *client = UA_Client_new();
    if (!client) return 2;
    UA_ClientConfig_setDefault(UA_Client_getConfig(client));
    UA_StatusCode rc = UA_Client_connect(client, "opc.tcp://127.0.0.1:4840/musitu/");
    if (rc != UA_STATUSCODE_GOOD) {
        fprintf(stderr, "connect failed: 0x%08x\n", rc);
        UA_Client_delete(client);
        return 3;
    }
    UA_Variant value;
    UA_Variant_init(&value);
    rc = UA_Client_readValueAttribute(client, UA_NODEID_NUMERIC(0, UA_NS0ID_SERVER_SERVERSTATUS), &value);
    if (rc != UA_STATUSCODE_GOOD || UA_Variant_isEmpty(&value)) {
        fprintf(stderr, "read failed: 0x%08x\n", rc);
        UA_Variant_clear(&value);
        UA_Client_disconnect(client);
        UA_Client_delete(client);
        return 4;
    }
    printf("OPCUA_OPEN62541_INTEROP=PASS\n");
    UA_Variant_clear(&value);
    UA_Client_disconnect(client);
    UA_Client_delete(client);
    return 0;
}
