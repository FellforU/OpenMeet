use std::io::Write;
use std::path::PathBuf;

/// Write PCM i16 samples as a WAV file
pub fn write_wav(path: &PathBuf, samples: &[i16], sample_rate: u32, channels: u16) -> Result<(), String> {
    let data_len = (samples.len() * 2) as u32;
    let file_len = 36 + data_len;
    let byte_rate = sample_rate * (channels as u32) * 2;
    let block_align = channels * 2;

    let mut file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to create WAV file: {}", e))?;

    file.write_all(b"RIFF").map_err(|e| e.to_string())?;
    file.write_all(&file_len.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(b"WAVE").map_err(|e| e.to_string())?;

    file.write_all(b"fmt ").map_err(|e| e.to_string())?;
    file.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&channels.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&byte_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&block_align.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&16u16.to_le_bytes()).map_err(|e| e.to_string())?;

    file.write_all(b"data").map_err(|e| e.to_string())?;
    file.write_all(&data_len.to_le_bytes()).map_err(|e| e.to_string())?;

    for sample in samples {
        file.write_all(&sample.to_le_bytes()).map_err(|e| e.to_string())?;
    }

    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Read PCM i16 samples from a WAV file (skipping the 44-byte header)
pub fn read_wav_samples(path: &PathBuf) -> Result<(Vec<i16>, u32, u16), String> {
    let data = std::fs::read(path)
        .map_err(|e| format!("Failed to read WAV file: {}", e))?;
    if data.len() < 44 {
        return Err("Invalid WAV file: too short".to_string());
    }
    let channels = u16::from_le_bytes([data[22], data[23]]);
    let sample_rate = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);
    let pcm_data = &data[44..];
    let samples: Vec<i16> = pcm_data
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    Ok((samples, sample_rate, channels))
}
