import com.android.apksig.ApkSigner;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.List;

/**
 * Signs the unsigned APK from GitHub (android/dist) with the owner's key.
 * Usage: java -cp apksig.jar Sign.java in.apk out.apk key.keystore alias password
 * (android/sign/sign.sh fetches apksig and runs this).
 */
public class Sign {
  public static void main(String[] a) throws Exception {
    KeyStore ks = KeyStore.getInstance(new File(a[2]), a[4].toCharArray());
    PrivateKey key = (PrivateKey) ks.getKey(a[3], a[4].toCharArray());
    X509Certificate cert = (X509Certificate) ks.getCertificate(a[3]);
    ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("mchosting", key, List.of(cert)).build();
    new ApkSigner.Builder(List.of(signer))
        .setInputApk(new File(a[0]))
        .setOutputApk(new File(a[1]))
        .setMinSdkVersion(24)
        .setV1SigningEnabled(false) // minSdk 24: v2 is enough (old apksig v1 breaks on new Java)
        .setV2SigningEnabled(true)
        .build()
        .sign();
    System.out.println("Signed " + a[1]);
  }
}
