const dictData = { properties: {} };
const dictError = null;

let basePermissions;
if (!dictError && dictData?.properties?.permissions) {
    basePermissions = dictData.properties.permissions;
} else {
    basePermissions = "ALL_MODULES_FULL";
}

console.log(basePermissions);
