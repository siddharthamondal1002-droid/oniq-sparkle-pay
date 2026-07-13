package com.oniqhub.app;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.provider.ContactsContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(
    name = "ContactsBridge",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts")
    }
)
public class ContactsBridgePlugin extends Plugin {

    private static final int MAX_CONTACTS = 2000;

    @PluginMethod
    public void getContacts(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "permCallback");
            return;
        }
        loadContacts(call);
    }

    @PermissionCallback
    private void permCallback(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            loadContacts(call);
        } else {
            call.reject("denied");
        }
    }

    private void loadContacts(PluginCall call) {
        try {
            ContentResolver cr = getContext().getContentResolver();
            String[] proj = new String[] {
                ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            };
            Cursor c = cr.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                proj, null, null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            );
            // LinkedHashMap preserves order, cap by contact id
            Map<String, JSObject> byId = new HashMap<>();
            Map<String, Set<String>> phonesById = new HashMap<>();

            if (c != null) {
                int idxId = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID);
                int idxName = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int idxNum = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                while (c.moveToNext() && byId.size() < MAX_CONTACTS) {
                    String id = idxId >= 0 ? c.getString(idxId) : null;
                    if (id == null) continue;
                    String name = idxName >= 0 ? c.getString(idxName) : null;
                    String num = idxNum >= 0 ? c.getString(idxNum) : null;
                    if (num == null || num.isEmpty()) continue;

                    JSObject entry = byId.get(id);
                    Set<String> phones = phonesById.get(id);
                    if (entry == null) {
                        entry = new JSObject();
                        entry.put("name", name == null ? "" : name);
                        phones = new LinkedHashSet<>();
                        byId.put(id, entry);
                        phonesById.put(id, phones);
                    }
                    phones.add(num);
                }
                c.close();
            }

            JSArray out = new JSArray();
            for (Map.Entry<String, JSObject> e : byId.entrySet()) {
                JSObject entry = e.getValue();
                Set<String> phones = phonesById.get(e.getKey());
                JSONArray arr = new JSONArray();
                if (phones != null) for (String p : phones) arr.put(p);
                entry.put("phones", arr);
                out.put(entry);
            }

            JSObject ret = new JSObject();
            ret.put("contacts", out);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage());
        }
    }
}
