const FULL_ACCESS = { create: true, edit: true, delete: true };
const ALL_MODULES_FULL = { assets: FULL_ACCESS };

let dictData = null; // simulate maybeSingle returning null when no row is found
let dictError = null;
let roleCode = 'USER';

let basePermissions;

if (roleCode === 'SYS_ADMIN') {
    basePermissions = ALL_MODULES_FULL;
} else if (!dictError && dictData?.properties?.permissions) {
    basePermissions = dictData.properties.permissions;
} else {
    basePermissions = ALL_MODULES_FULL;
}

const userOverrides = {};
const finalPermissions = { ...basePermissions };

Object.keys(userOverrides).forEach(moduleKey => {
    finalPermissions[moduleKey] = {
        ...(finalPermissions[moduleKey] || {}),
        ...userOverrides[moduleKey]
    };
});

console.log("FINAL PERMISSIONS:", finalPermissions);
console.log("canCreate:", finalPermissions?.assets?.create === true);
