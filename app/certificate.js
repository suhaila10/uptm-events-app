import { Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../src/screens/firebase';

// Import your local images
const pendidikanLogo = require('../assets/images/Kementerian_Pendidikan_Malaysia.png');
const maraCorporationLogo = require('../assets/images/maracorporation.png');
const maraLogo = require('../assets/images/mara.png');
const kptmLogo = require('../assets/images/kptmlogo.png');
const uptmLogo = require('../assets/images/uptm.png');
const madaniLogo = require('../assets/images/madani.png');
const fcomLogo = require('../assets/images/fcom.png');

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CertificateScreen() {
  const { eventId } = useLocalSearchParams();
  const [eventData, setEventData] = useState(null);
  const [dbUser, setDbUser] = useState(null);
  const [attendanceRecord, setAttendanceRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [imageUris, setImageUris] = useState({
    pendidikan: '',
    maraCorp: '',
    mara: '',
    kptm: '',
    uptm: '',
    madani: '',
    fcom: ''
  });

  // Load images and convert to base64 using the new File API
  useEffect(() => {
    const loadImages = async () => {
      try {
        // Download assets to get local URIs
        const pendidikanAsset = Asset.fromModule(pendidikanLogo);
        const maraCorpAsset = Asset.fromModule(maraCorporationLogo);
        const maraAsset = Asset.fromModule(maraLogo);
        const kptmAsset = Asset.fromModule(kptmLogo);
        const uptmAsset = Asset.fromModule(uptmLogo);
        const madaniAsset = Asset.fromModule(madaniLogo);
        const fcomAsset = Asset.fromModule(fcomLogo);

        await Promise.all([
          pendidikanAsset.downloadAsync(),
          maraCorpAsset.downloadAsync(),
          maraAsset.downloadAsync(),
          kptmAsset.downloadAsync(),
          uptmAsset.downloadAsync(),
          madaniAsset.downloadAsync(),
          fcomAsset.downloadAsync()
        ]);

        // Get local URIs
        const pendidikanUri = pendidikanAsset.localUri || pendidikanAsset.uri;
        const maraCorpUri = maraCorpAsset.localUri || maraCorpAsset.uri;
        const maraUri = maraAsset.localUri || maraAsset.uri;
        const kptmUri = kptmAsset.localUri || kptmAsset.uri;
        const uptmUri = uptmAsset.localUri || uptmAsset.uri;
        const madaniUri = madaniAsset.localUri || madaniAsset.uri;
        const fcomUri = fcomAsset.localUri || fcomAsset.uri;

        // Create File instances and read as base64 using the new API
        const pendidikanFile = new File(pendidikanUri);
        const maraCorpFile = new File(maraCorpUri);
        const maraFile = new File(maraUri);
        const kptmFile = new File(kptmUri);
        const uptmFile = new File(uptmUri);
        const madaniFile = new File(madaniUri);
        const fcomFile = new File(fcomUri);

        const [
          pendidikanBase64,
          maraCorpBase64,
          maraBase64,
          kptmBase64,
          uptmBase64,
          madaniBase64,
          fcomBase64
        ] = await Promise.all([
          pendidikanFile.base64(),
          maraCorpFile.base64(),
          maraFile.base64(),
          kptmFile.base64(),
          uptmFile.base64(),
          madaniFile.base64(),
          fcomFile.base64()
        ]);

        // Store URIs for use in HTML
        setImageUris({
          pendidikan: `data:image/png;base64,${pendidikanBase64}`,
          maraCorp: `data:image/png;base64,${maraCorpBase64}`,
          mara: `data:image/png;base64,${maraBase64}`,
          kptm: `data:image/png;base64,${kptmBase64}`,
          uptm: `data:image/png;base64,${uptmBase64}`,
          madani: `data:image/png;base64,${madaniBase64}`,
          fcom: `data:image/png;base64,${fcomBase64}`
        });
      } catch (err) {
        console.error('Error loading images:', err);
        // Set empty strings as fallback
        setImageUris({
          pendidikan: '',
          maraCorp: '',
          mara: '',
          kptm: '',
          uptm: '',
          madani: '',
          fcom: ''
        });
      }
    };
    loadImages();
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setError('Please login to view certificates');
        return;
      }

      // Fetch user data
      const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
      if (!userSnap.exists()) {
        setError('User data not found');
        return;
      }
      setDbUser(userSnap.data());

      // Fetch event data
      if (!eventId) {
        setError('No event specified');
        return;
      }
      const eventSnap = await getDoc(doc(db, 'events', eventId));
      if (!eventSnap.exists()) {
        setError('Event not found');
        return;
      }
      const event = { id: eventSnap.id, ...eventSnap.data() };
      setEventData(event);

      // Check attendance
      const attendanceQuery = query(
        collection(db, 'attendance'),
        where('eventId', '==', eventId),
        where('userId', '==', currentUser.uid)
      );
      const attendanceSnap = await getDocs(attendanceQuery);
      if (!attendanceSnap.empty) {
        const record = attendanceSnap.docs[0].data();
        setAttendanceRecord(record);
        if (record.status !== 'present' && record.status !== 'late') {
          setError('You did not attend this event');
        }
      } else {
        if (event.attendees?.includes(currentUser.uid)) {
          setError('You registered but attendance was not marked');
        } else {
          setError('You did not attend this event');
        }
      }
    } catch (err) {
      console.error('Error loading certificate data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-MY', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const generateHTML = () => {
    const participantName = dbUser?.name || 'Participant';
    const matricNumber = dbUser?.matricNumber || dbUser?.studentId || '';
    const eventTitle = eventData?.title || 'Event';
    const eventDate = formatDate(eventData?.date);
    const eventCode = eventData?.eventCode || 'N/A';
    const certificateId = `UPTM/CERT/${eventCode}/${Date.now().toString().slice(-6)}`;
    const status = attendanceRecord?.status === 'present' ? 'Present' : 'Late';

    // Use loaded images or empty strings
    const pendidikanImg = imageUris.pendidikan || '';
    const maraCorpImg = imageUris.maraCorp || '';
    const maraImg = imageUris.mara || '';
    const kptmImg = imageUris.kptm || '';
    const uptmImg = imageUris.uptm || '';
    const madaniImg = imageUris.madani || '';
    const fcomImg = imageUris.fcom || '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>UPTM Certificate</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 0;
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            margin: 0;
            padding: 0;
            background: white;
            font-family: 'Helvetica', 'Arial', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          
          .certificate {
            width: 297mm;
            height: 210mm;
            background: white;
            position: relative;
            box-sizing: border-box;
            border: 12px solid #8B0000;
            outline: 2px solid #00347A;
            outline-offset: -4px;
            padding: 2mm 25mm;
            display: flex;
            flex-direction: column;
            line-height: 1.4;
          }
          
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 0;
          }
          
          .left-logos img {
            height: 40px;
            width: auto;
            object-fit: contain;
          }
          
          .right-logos {
            display: flex;
            gap: 20px;
          }
          
          .right-logos img {
            height: 40px;
            width: auto;
            object-fit: contain;
          }
          
          .uptm-section {
            text-align: center;
            margin: 0;
            padding: 0;
            line-height: 0;
          }
          
          .uptm-logo {
            width: 200px;
            height: auto;
            max-height: 200px;
            object-fit: contain;
            margin: 0 auto;
            display: block;
          }
          
          .decoration {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
            margin: 4px 0;
          }
          
          .line {
            width: 120px;
            height: 2px;
            background: #FFD700;
          }
          
          .main-title {
            color: #8B0000;
            font-size: 32px;
            font-weight: bold;
            text-align: center;
            margin: 4px 0;
          }
          
          .subtitle {
            color: #00347A;
            font-size: 18px;
            font-style: italic;
            text-align: center;
            margin: 6px 0 4px;
          }
          
          .name-box {
            background: #FFF9E6;
            border: 2px solid #FFD700;
            border-radius: 50px;
            padding: 8px 40px;
            margin: 8px auto;
            display: inline-block;
            text-align: center;
          }
          
          .name {
            color: #8B0000;
            font-size: 36px;
            font-weight: bold;
            margin: 0;
          }
          
          .matric {
            color: #666;
            font-size: 14px;
            margin: 4px 0 8px;
            text-align: center;
          }
          
          .event-title {
            color: #8B0000;
            font-size: 28px;
            font-weight: bold;
            text-align: center;
            margin: 8px 0;
            padding: 0 30px;
            word-wrap: break-word;
          }
          
          .date {
            color: #8B0000;
            font-size: 20px;
            font-weight: bold;
            text-align: center;
            margin: 8px 0 15mm;
          }
          
          .content {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            margin-top: 0;
            padding-top: 0;
          }
          
          .footer {
            display: flex;
            justify-content: center;
            margin-top: 10mm;
            position: relative;
          }
          
          .signature {
            text-align: center;
            width: 250px;
          }
          
          .signature-line {
            width: 200px;
            height: 2px;
            background: #8B0000;
            margin: 0 auto 8px;
          }
          
          .signature-name {
            color: #8B0000;
            font-size: 16px;
            font-weight: bold;
            margin: 0;
          }
          
          .signature-title {
            color: #00347A;
            font-size: 14px;
            margin: 2px 0 0;
          }
          
          .fcom-logo {
            position: absolute;
            bottom: 10px;
            right: 25mm;
            width: 80px;
            height: auto;
            object-fit: contain;
          }
          
          .certificate-id {
            color: #999;
            font-size: 10px;
            text-align: center;
            margin-top: 10px;
          }
          
          .event-code {
            color: #999;
            font-size: 10px;
            position: absolute;
            bottom: 10px;
            left: 25mm;
          }
          
          .attendance-status {
            color: #999;
            font-size: 10px;
            position: absolute;
            bottom: 10px;
            right: 120px;
          }
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        <div class="certificate">
          <div class="header">
            <div class="left-logos">
              ${madaniImg ? `<img src="${madaniImg}" alt="Madani">` : '<div style="height:40px; width:40px; background:#f0f0f0;"></div>'}
            </div>
            <div class="right-logos">
              ${maraCorpImg ? `<img src="${maraCorpImg}" alt="MARA Corp">` : '<div style="height:40px; width:40px; background:#f0f0f0;"></div>'}
              ${pendidikanImg ? `<img src="${pendidikanImg}" alt="Ministry">` : '<div style="height:40px; width:40px; background:#f0f0f0;"></div>'}
              ${maraImg ? `<img src="${maraImg}" alt="MARA">` : '<div style="height:40px; width:40px; background:#f0f0f0;"></div>'}
              ${kptmImg ? `<img src="${kptmImg}" alt="KPTM">` : '<div style="height:40px; width:40px; background:#f0f0f0;"></div>'}
            </div>
          </div>
          
          <div class="uptm-section">
            ${uptmImg ? `<img src="${uptmImg}" class="uptm-logo" alt="UPTM">` : '<div style="height:100px; width:100px; background:#f0f0f0; margin:0 auto;"></div>'}
          </div>
          
          <div class="content">
            <div class="decoration">
              <div class="line"></div>
              <div class="main-title">CERTIFICATE OF PARTICIPATION</div>
              <div class="line"></div>
            </div>
            
            <div class="subtitle">THIS IS TO CERTIFY THAT</div>
            
            <div style="text-align: center;">
              <div class="name-box">
                <p class="name">${participantName}</p>
              </div>
            </div>
            
            ${matricNumber ? `<p class="matric">Matric No: ${matricNumber}</p>` : ''}
            
            <div class="subtitle">FOR ACTIVE PARTICIPATION IN</div>
            
            <p class="event-title">${eventTitle}</p>
            
            <div class="subtitle">HELD ON</div>
            
            <p class="date">${eventDate}</p>
            
            <div class="footer">
              <div class="signature">
                <div class="signature-line"></div>
                <p class="signature-name">PROF. MADYA DR. SAIFUDDIN BIN HJ. MOHTARAM</p>
                <p class="signature-title">Dean of FCOM</p>
              </div>
            </div>
          </div>
          
          ${fcomImg ? `<img src="${fcomImg}" class="fcom-logo" alt="FCOM">` : ''}
          
          <div class="certificate-id">Certificate ID: ${certificateId}</div>
          <div class="event-code">Event: ${eventCode}</div>
          <div class="attendance-status">Status: ${status}</div>
        </div>
      </body>
      </html>
    `;
  };

  const generatePDF = async () => {
    try {
      setGenerating(true);
      
      const html = generateHTML();
      const { uri } = await Print.printToFileAsync({ html });
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Save Certificate',
          UTI: 'com.adobe.pdf'
        });
      } else {
        Alert.alert('Success', `Certificate saved to: ${uri}`);
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      Alert.alert('Error', 'Failed to generate certificate: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const PreviewModal = () => (
    <Modal
      animationType="slide"
      transparent={false}
      visible={showPreviewModal}
      onRequestClose={() => setShowPreviewModal(false)}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowPreviewModal(false)}>
            <Ionicons name="close" size={28} color="#8B0000" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Certificate Preview</Text>
          <View style={{ width: 28 }} />
        </View>
        
        <ScrollView contentContainerStyle={styles.modalContent}>
          <View style={styles.previewCertificate}>
            <View style={styles.previewHeader}>
              <View style={styles.previewLeftLogo}>
                <Text style={styles.previewLogoText}>MADANI</Text>
              </View>
              <View style={styles.previewRightLogos}>
                <Text style={styles.previewLogoTextSmall}>MARA Corp</Text>
                <Text style={styles.previewLogoTextSmall}>Ministry</Text>
                <Text style={styles.previewLogoTextSmall}>MARA</Text>
                <Text style={styles.previewLogoTextSmall}>KPTM</Text>
              </View>
            </View>
            
            <View style={styles.previewUptmSection}>
              <Text style={styles.previewUptmLogo}>UPTM</Text>
              <Text style={styles.previewUptmTitle}>UNIVERSITI POLY-TECH MALAYSIA</Text>
              <Text style={styles.previewUptmSubtitle}>KUALA LUMPUR</Text>
            </View>
            
            <View style={styles.previewDecoration}>
              <View style={styles.previewLine} />
              <Text style={styles.previewMainTitle}>CERTIFICATE OF PARTICIPATION</Text>
              <View style={styles.previewLine} />
            </View>
            
            <Text style={styles.previewSubtitle}>THIS IS TO CERTIFY THAT</Text>
            
            <View style={styles.previewNameBox}>
              <Text style={styles.previewName}>{dbUser?.name || 'Participant'}</Text>
            </View>
            
            {dbUser?.matricNumber && (
              <Text style={styles.previewMatric}>Matric No: {dbUser.matricNumber}</Text>
            )}
            
            <Text style={styles.previewSubtitle}>FOR ACTIVE PARTICIPATION IN</Text>
            <Text style={styles.previewEventTitle}>{eventData?.title}</Text>
            <Text style={styles.previewSubtitle}>HELD ON</Text>
            <Text style={styles.previewDate}>{formatDate(eventData?.date)}</Text>
            
            <View style={styles.previewFooter}>
              <View style={styles.previewSignature}>
                <View style={styles.previewSignatureLine} />
                <Text style={styles.previewSignatureName}>PROF. MADYA DR. SAIFUDDIN BIN HJ. MOHTARAM</Text>
                <Text style={styles.previewSignatureTitle}>Dean of FCOM</Text>
              </View>
            </View>
          </View>
        </ScrollView>
        
        <View style={styles.modalButtons}>
          <TouchableOpacity
            style={[styles.modalButton, styles.previewButton]}
            onPress={() => setShowPreviewModal(false)}
          >
            <Text style={styles.modalButtonText}>Close Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalButton, styles.downloadModalButton]}
            onPress={generatePDF}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.modalButtonText}>Download PDF</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B0000" />
        <Text style={styles.loadingText}>Loading certificate data...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Certificate</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={60} color="#e74c3c" />
          <Text style={styles.errorTitle}>Certificate Not Available</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.previewCard}>
          <View style={styles.logoRow}>
            <View style={styles.leftLogo}>
              <Text style={styles.logoText}>MADANI</Text>
            </View>
            <View style={styles.rightLogos}>
              <Text style={styles.logoTextSmall}>MARA Corp</Text>
              <Text style={styles.logoTextSmall}>Ministry</Text>
              <Text style={styles.logoTextSmall}>MARA</Text>
              <Text style={styles.logoTextSmall}>KPTM</Text>
            </View>
          </View>
          
          <Text style={styles.previewUptmTitle}>UNIVERSITI POLY-TECH MALAYSIA</Text>
          <Text style={styles.previewUptmSubtitle}>KUALA LUMPUR</Text>
          
          <View style={styles.previewDecoration}>
            <View style={styles.previewLine} />
            <Text style={styles.previewTitle}>CERTIFICATE OF PARTICIPATION</Text>
            <View style={styles.previewLine} />
          </View>
          
          <Text style={styles.previewSubtitle}>THIS IS TO CERTIFY THAT</Text>
          
          <Text style={styles.previewName}>{dbUser?.name || 'Participant'}</Text>
          
          {dbUser?.matricNumber && (
            <Text style={styles.previewMatric}>Matric No: {dbUser.matricNumber}</Text>
          )}
          
          <Text style={styles.previewSubtitle}>FOR ACTIVE PARTICIPATION IN</Text>
          
          <Text style={styles.previewEvent}>{eventData?.title}</Text>
          
          <Text style={styles.previewSubtitle}>HELD ON</Text>
          
          <Text style={styles.previewDate}>{formatDate(eventData?.date)}</Text>
          
          <View style={styles.signatureRow}>
            <View style={styles.signatureLine}>
              <View style={styles.signatureDivider} />
              <Text style={styles.signatureName}>PROF. MADYA DR. SAIFUDDIN BIN HJ. MOHTARAM</Text>
              <Text style={styles.signatureTitle}>Dean of FCOM</Text>
            </View>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.generateButton, generating && styles.disabled]}
            onPress={() => setShowPreviewModal(true)}
          >
            <Ionicons name="eye-outline" size={24} color="#fff" />
            <Text style={styles.generateText}>Preview Certificate</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.downloadButton, generating && styles.disabled]}
            onPress={generatePDF}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="download-outline" size={24} color="#fff" />
                <Text style={styles.generateText}>Download PDF</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <PreviewModal />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 10,
    color: '#8B0000',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#8B0000',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  content: {
    padding: 20,
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#e74c3c',
    marginTop: 10,
    marginBottom: 5,
  },
  errorMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  closeBtn: {
    backgroundColor: '#8B0000',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  previewCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#8B0000',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  logoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 15,
  },
  leftLogo: {
    alignItems: 'center',
  },
  logoText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#8B0000',
  },
  rightLogos: {
    flexDirection: 'row',
    gap: 10,
  },
  logoTextSmall: {
    fontSize: 10,
    color: '#00347A',
    marginLeft: 10,
  },
  previewUptmTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
    marginTop: 10,
  },
  previewUptmSubtitle: {
    fontSize: 12,
    color: '#00347A',
    textAlign: 'center',
    marginBottom: 15,
  },
  previewDecoration: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginVertical: 10,
  },
  previewLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#FFD700',
    marginHorizontal: 10,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
  },
  previewSubtitle: {
    fontSize: 12,
    color: '#00347A',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 10,
  },
  previewName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
    backgroundColor: '#FFF9E6',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#FFD700',
    marginVertical: 10,
  },
  previewMatric: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 5,
  },
  previewEvent: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
    marginVertical: 5,
  },
  previewDate: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
    marginBottom: 20,
  },
  signatureRow: {
    marginTop: 10,
    alignItems: 'center',
    width: '100%',
  },
  signatureLine: {
    alignItems: 'center',
    width: '100%',
  },
  signatureDivider: {
    width: 150,
    height: 2,
    backgroundColor: '#8B0000',
    marginBottom: 8,
  },
  signatureName: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
  },
  signatureTitle: {
    fontSize: 10,
    color: '#00347A',
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  generateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B0000',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  downloadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00347A',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  disabled: {
    opacity: 0.5,
  },
  generateText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#8B0000',
  },
  modalContent: {
    padding: 20,
    alignItems: 'center',
  },
  previewCertificate: {
    width: SCREEN_WIDTH - 40,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
    borderColor: '#8B0000',
    alignItems: 'center',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 15,
  },
  previewLeftLogo: {
    alignItems: 'center',
  },
  previewLogoText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#8B0000',
  },
  previewRightLogos: {
    flexDirection: 'row',
    gap: 8,
  },
  previewLogoTextSmall: {
    fontSize: 8,
    color: '#00347A',
  },
  previewUptmLogo: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
  },
  previewMainTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
  },
  previewEventTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
    marginVertical: 5,
  },
  previewFooter: {
    marginTop: 15,
    alignItems: 'center',
    width: '100%',
  },
  previewSignature: {
    alignItems: 'center',
  },
  previewSignatureLine: {
    width: 150,
    height: 2,
    backgroundColor: '#8B0000',
    marginBottom: 8,
  },
  previewSignatureName: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#8B0000',
    textAlign: 'center',
  },
  previewSignatureTitle: {
    fontSize: 9,
    color: '#00347A',
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    padding: 20,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  previewButton: {
    backgroundColor: '#6c757d',
  },
  downloadModalButton: {
    backgroundColor: '#8B0000',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  previewNameBox: {
    backgroundColor: '#FFF9E6',
    borderWidth: 1,
    borderColor: '#FFD700',
    borderRadius: 30,

    paddingHorizontal: 20,
    paddingVertical: 8,
    marginVertical: 10,
  },
  previewUptmSection: {
    alignItems: 'center',
    marginVertical: 10,
  },
});