use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use rand::rngs::OsRng;
use rsa::{Oaep, RsaPrivateKey, RsaPublicKey};
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey, DecodePublicKey, EncodePublicKey, LineEnding};
use sha2::Sha256;

pub struct CryptoState {
    keys_dir: Mutex<Option<PathBuf>>,
}

impl CryptoState {
    pub fn new() -> Self {
        Self {
            keys_dir: Mutex::new(None),
        }
    }

    pub fn init(&self, app_data_dir: &PathBuf) {
        let dir = app_data_dir.join("keys");
        std::fs::create_dir_all(&dir).ok();
        if let Ok(mut guard) = self.keys_dir.lock() {
            *guard = Some(dir);
        }
    }
}

fn get_keys_dir(state: &CryptoState) -> Result<PathBuf, String> {
    state
        .keys_dir
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Crypto not initialized".to_string())
}

fn ensure_keypair(keys_dir: &PathBuf) -> Result<(RsaPrivateKey, RsaPublicKey), String> {
    let priv_path = keys_dir.join("private.pem");
    let pub_path = keys_dir.join("public.pem");

    if priv_path.exists() && pub_path.exists() {
        let priv_pem = std::fs::read_to_string(&priv_path)
            .map_err(|e| format!("Failed to read private key: {}", e))?;
        let pub_pem = std::fs::read_to_string(&pub_path)
            .map_err(|e| format!("Failed to read public key: {}", e))?;

        let private_key = RsaPrivateKey::from_pkcs8_pem(&priv_pem)
            .map_err(|e| format!("Failed to parse private key: {}", e))?;
        let public_key = RsaPublicKey::from_public_key_pem(&pub_pem)
            .map_err(|e| format!("Failed to parse public key: {}", e))?;

        return Ok((private_key, public_key));
    }

    // Generate new 2048-bit RSA keypair
    let mut rng = OsRng;
    let private_key = RsaPrivateKey::new(&mut rng, 2048)
        .map_err(|e| format!("Failed to generate RSA key: {}", e))?;
    let public_key = RsaPublicKey::from(&private_key);

    // Save to PEM files
    let priv_pem = private_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| format!("Failed to encode private key: {}", e))?;
    let pub_pem = public_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| format!("Failed to encode public key: {}", e))?;

    std::fs::write(&priv_path, priv_pem.as_bytes())
        .map_err(|e| format!("Failed to write private key: {}", e))?;
    std::fs::write(&pub_path, pub_pem.as_bytes())
        .map_err(|e| format!("Failed to write public key: {}", e))?;

    Ok((private_key, public_key))
}

#[tauri::command]
pub async fn encrypt_secret(
    state: tauri::State<'_, CryptoState>,
    plaintext: String,
) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }

    let keys_dir = get_keys_dir(&state)?;
    let (_, public_key) = ensure_keypair(&keys_dir)?;

    let padding = Oaep::new::<Sha256>();
    let mut rng = OsRng;
    let encrypted = public_key
        .encrypt(&mut rng, padding, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    Ok(BASE64.encode(&encrypted))
}

#[tauri::command]
pub async fn decrypt_secret(
    state: tauri::State<'_, CryptoState>,
    ciphertext: String,
) -> Result<String, String> {
    if ciphertext.is_empty() {
        return Ok(String::new());
    }

    let keys_dir = get_keys_dir(&state)?;
    let (private_key, _) = ensure_keypair(&keys_dir)?;

    let encrypted = BASE64
        .decode(&ciphertext)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    let padding = Oaep::new::<Sha256>();
    let decrypted = private_key
        .decrypt(padding, &encrypted)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(decrypted)
        .map_err(|e| format!("Invalid UTF-8 after decryption: {}", e))
}
