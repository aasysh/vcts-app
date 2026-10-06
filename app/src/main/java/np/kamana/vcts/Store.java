package np.kamana.vcts;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App data on the phone. The VCTS password is encrypted with a key kept in the phone's secure key store. */
final class Store {

    private static final String KEY_ALIAS = "vcts_helper_pw";
    private final SharedPreferences prefs;

    Store(Context c) {
        prefs = c.getSharedPreferences("vcts", Context.MODE_PRIVATE);
    }

    String get(String key) {
        return prefs.getString("k_" + key, "");
    }

    void put(String key, String value) {
        prefs.edit().putString("k_" + key, value).apply();
    }

    boolean hasPassword() {
        return !prefs.getString("pw", "").isEmpty();
    }

    void setPassword(String pw) {
        try {
            prefs.edit().putString("pw", encrypt(pw)).apply();
        } catch (Exception e) {
            prefs.edit().remove("pw").apply();
        }
    }

    String password() throws Exception {
        String v = prefs.getString("pw", "");
        if (v.isEmpty()) throw new Exception("Password छैन।");
        try {
            return decrypt(v);
        } catch (Exception e) {
            throw new Exception("Password पढ्न सकिएन — सेटिङ मा फेरि राख्नुहोस्।");
        }
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            kg.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
    }

    private static String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private static String decrypt(String stored) throws Exception {
        int i = stored.indexOf(':');
        byte[] iv = Base64.decode(stored.substring(0, i), Base64.NO_WRAP);
        byte[] ct = Base64.decode(stored.substring(i + 1), Base64.NO_WRAP);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(c.doFinal(ct), StandardCharsets.UTF_8);
    }
}
