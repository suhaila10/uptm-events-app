import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function Captcha({ onVerify }) {
  const [captcha, setCaptcha] = useState('');
  const [userInput, setUserInput] = useState('');
  const [error, setError] = useState('');

  const generateCaptcha = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCaptcha(result);
    setUserInput('');
    setError('');
  };

  useEffect(() => {
    generateCaptcha();
  }, []);

  // ✅ Auto verify logic
  useEffect(() => {
    if (userInput.length < 6) {
      setError('');
      onVerify(false);
      return;
    }

    if (userInput.toUpperCase() === captcha) {
      onVerify(true);
      setError('');
    } else {
      onVerify(false);
      setError('Incorrect code');

      // 🔄 Auto refresh
      setTimeout(() => {
        generateCaptcha();
      }, 800);
    }
  }, [userInput, captcha]);

  // Fake distortion (spacing + slight randomness)
  const renderCaptcha = () => {
    return captcha.split('').map((char, index) => {
      const rotate = Math.random() * 20 - 10;
      const marginTop = Math.random() * 6;

      return (
        <Text
          key={index}
          style={[
            styles.captchaChar,
            {
              transform: [{ rotate: `${rotate}deg` }],
              marginTop,
            },
          ]}
        >
          {char}
        </Text>
      );
    });
  };

  return (
    <View style={styles.wrapper}>
      
      {/* CAPTCHA display */}
      <View style={styles.captchaBox}>
        <View style={styles.captchaRow}>
          {renderCaptcha()}
        </View>

        <TouchableOpacity onPress={generateCaptcha} style={styles.refresh}>
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Input */}
      <TextInput
        style={styles.input}
        placeholder="Enter CAPTCHA"
        placeholderTextColor="#aaa"
        value={userInput}
        onChangeText={setUserInput}
        maxLength={6}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 10,
  },

  captchaBox: {
    backgroundColor: '#f1f3f6',
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    position: 'relative',
  },

  captchaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },

  captchaChar: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#2E3B55',
    marginHorizontal: 3,
  },

  refresh: {
    position: 'absolute',
    right: 10,
    top: 8,
  },

  refreshText: {
    fontSize: 16,
    color: '#2E3B55',
    fontWeight: 'bold',
  },

  input: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 25,
    padding: 12,
    backgroundColor: '#fafafa',
    fontSize: 16,
  },

  error: {
    color: '#dc3545',
    fontSize: 12,
    marginTop: 5,
    marginLeft: 5,
  },
});