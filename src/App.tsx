/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { clsx, type ClassValue } from 'clsx'; 
import { cn } from './lib/utils.js'; 
import { Upload, Download, Check, AlertCircle, FileText, Trash2, Filter, Search } from 'lucide-react';
import './App.css'; 
Upload, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  Trash2, 
  ShieldCheck, 
  CreditCard, 
  Globe, 
  Zap,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Info,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parse, isValid } from 'date-fns';
import { cn } from './lib/utils';

// --- Types ---

interface DataRow {
  [key: string]: any;
}

interface CleaningStats {
  rowsProcessed: number;
  duplicatesRemoved: number;
  missingValuesFilled: number;
  outliersFlagged: number;
  gpsErrorsFixed: number;
  datesReformatted: number;
}

interface PaymentPlan {
  id: string;
  name: string;
  price: string;
  period: string;
  features: string[];
  bestFor: string;
  recommended?: boolean;
}

// --- Constants ---

const PLANS: PaymentPlan[] = [
  {
    id: 'freemium',
    name: 'Freemium',
    price: '$2',
    period: 'Forever',
    features: ['Up to 50 rows', 'Case fixing', 'Missing values handler'],
    bestFor: 'Individual students or small project interns.'
  },
  {
    id: 'pay-per-use',
    name: 'Pay-Per-Use',
    price: '$49',
    period: '90 days',
    features: ['Unlimited access', 'All cleaning features', 'Priority support'],
    bestFor: 'Independent consultants or projects with one-off surveys.',
    recommended: true
  },
  {
    id: 'pro',
    name: 'Pro Subscription',
    price: '$150',
    period: 'per year',
    features: ['Unlimited rows', 'AI outlier detection', 'Team collaboration'],
    bestFor: 'Active M&E teams at NGOs or government agencies.'
  }
];

const PayPalButton = ({ amount, onSuccess, onCancel }: { amount: string, onSuccess: () => void, onCancel: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clientId = (import.meta as any).env.VITE_GOOGLE_API_KEY || 'sb';
    
    if (!(window as any).paypal) {
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
      script.async = true;
      script.onload = () => setIsLoaded(true);
      script.onerror = () => setError("Failed to load PayPal SDK. Please check your Client ID.");
      document.body.appendChild(script);
    } else {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (isLoaded && containerRef.current && (window as any).paypal) {
      // Clear container before rendering
      containerRef.current.innerHTML = '';
      try {
        (window as any).paypal.Buttons({
          createOrder: (data: any, actions: any) => {
            return actions.order.create({
              purchase_units: [{
                amount: {
                  value: amount
                }
              }]
            });
          },
          onApprove: (data: any, actions: any) => {
            return actions.order.capture().then((details: any) => {
              onSuccess();
            });
          },
          onCancel: () => {
            onCancel();
          },
          onError: (err: any) => {
            console.error("PayPal Error", err);
            setError("PayPal encountered an error. Please try again.");
          }
        }).render(containerRef.current);
      } catch (e) {
        console.error("PayPal Render Error", e);
        setError("Could not initialize PayPal buttons.");
      }
    }
  }, [isLoaded, amount, onSuccess, onCancel]);

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm text-center">
        {error}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 text-sm font-medium">Loading PayPal...</p>
      </div>
    );
  }

  return <div ref={containerRef} className="min-h-[150px]" />;
};

// --- Helper Functions ---

const toProperCase = (str: any) => {
  if (typeof str !== 'string') return str;
  return str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
};

const isOutlier = (val: number, mean: number, std: number) => {
  if (std === 0) return false;
  return Math.abs(val - mean) > 3 * std;
};

const getStats = (data: number[]) => {
  const n = data.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = data.reduce((a, b) => a + b) / n;
  const std = Math.sqrt(data.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
  return { mean, std };
};

// --- Main Component ---

export default function App() {
  const [rawData, setRawData] = useState<DataRow[] | null>(null);
  const [cleanData, setCleanData] = useState<DataRow[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [stats, setStats] = useState<CleaningStats | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  
  // Load persisted state from localStorage
  const [activePlan, setActivePlan] = useState<string>(() => 
    localStorage.getItem('ss_activePlan') || 'freemium'
  );
  const [user, setUser] = useState<{ email: string } | null>(() => {
    const savedUser = localStorage.getItem('ss_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [uploadCount, setUploadCount] = useState<number>(() => 
    Number(localStorage.getItem('ss_uploadCount')) || 0
  );

  const [showPayment, setShowPayment] = useState(false);
  const [showAuth, setShowAuth] = useState<'signin' | 'signup' | null>(null);
  const [paymentStep, setPaymentStep] = useState<'options' | 'card' | 'paypal'>('options');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [paystackKeys, setPaystackKeys] = useState({
    public: (import.meta as any).env.VITE_PAYSTACK_PUBLIC_KEY || '',
    secret: ''
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state to localStorage
  React.useEffect(() => {
    localStorage.setItem('ss_activePlan', activePlan);
    localStorage.setItem('ss_uploadCount', uploadCount.toString());
    if (user) {
      localStorage.setItem('ss_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('ss_user');
    }
  }, [activePlan, uploadCount, user]);

  const handleAuth = async (email: string) => {
    try {
      // Detect country
      let country = 'Unknown';
      try {
        const geoRes = await fetch('https://ipapi.co/json/');
        const geoData = await geoRes.json();
        country = geoData.country_name || 'Unknown';
      } catch (e) {
        console.error("Geo detection failed", e);
      }

      const userData = { email, country, plan: activePlan };
      setUser({ email });
      setShowAuth(null);

      // Save to server
      await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
    } catch (err) {
      console.error("Auth sync failed", err);
    }
  };

  const fetchAdminData = async () => {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      setAdminUsers(data);
      setShowAdmin(true);
    } catch (err) {
      console.error("Failed to fetch admin data", err);
      alert("Failed to load admin dashboard");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (activePlan === 'freemium' && uploadCount >= 5) {
      alert("You have reached the limit of 5 uploads on the Freemium plan. Please upgrade to continue.");
      setShowPayment(true);
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setUploadCount(prev => prev + 1);
    
    // Update server upload count
    if (user) {
      try {
        await fetch('/api/users/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email })
        });
      } catch (err) {
        console.error("Failed to update server upload count", err);
      }
    }

    const reader = new FileReader();

    if (file.name.endsWith('.csv')) {
      reader.onload = (event) => {
        const text = event.target?.result as string;
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            setRawData(results.data as DataRow[]);
            setCleanData(null);
            setStats(null);
          }
        });
      };
      reader.readAsText(file);
    } else {
      reader.onload = (event) => {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        setRawData(json as DataRow[]);
        setCleanData(null);
        setStats(null);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const sanitizeData = useCallback(() => {
    if (!rawData) return;

    // Check plan restrictions
    if (activePlan === 'freemium' && rawData.length > 50) {
      alert("Freemium plan is limited to 50 rows. Please upgrade to process more data.");
      setShowPayment(true);
      return;
    }

    setIsCleaning(true);

    // Simulate processing delay for UX
    setTimeout(() => {
      let data = [...rawData];
      let duplicatesRemoved = 0;
      let missingValuesFilled = 0;
      let outliersFlagged = 0;
      let gpsErrorsFixed = 0;
      let datesReformatted = 0;

      // 1. Deduplication
      const initialCount = data.length;
      const seen = new Set();
      data = data.filter(row => {
        const id = row['Unique ID'] || row['Phone Number'] || JSON.stringify(row);
        if (seen.has(id)) {
          duplicatesRemoved++;
          return false;
        }
        seen.add(id);
        return true;
      });

      // Prepare for outlier detection
      const numericColumns = Object.keys(data[0] || {}).filter(key => 
        data.every(row => row[key] === undefined || row[key] === null || !isNaN(Number(row[key])))
      );
      
      const columnStats: Record<string, { mean: number; std: number }> = {};
      numericColumns.forEach(col => {
        const vals = data.map(r => Number(r[col])).filter(v => !isNaN(v));
        columnStats[col] = getStats(vals);
      });

      // 2. Core Cleaning Logic
      const sanitized = data.map(row => {
        const newRow = { ...row };

        Object.keys(newRow).forEach(key => {
          const val = newRow[key];
          const lowerKey = key.toLowerCase();

          // Case Standardization
          if (lowerKey === 'name' || lowerKey === 'location') {
            newRow[key] = toProperCase(val);
          }

          // Missing Data Handler
          if (val === undefined || val === null || val === '') {
            if (numericColumns.includes(key)) {
              newRow[key] = 0;
            } else {
              newRow[key] = "Not Provided";
            }
            missingValuesFilled++;
          }

          // Outlier Detection (Flagging)
          if (numericColumns.includes(key) && val !== undefined && val !== null && val !== '') {
            const numVal = Number(val);
            const { mean, std } = columnStats[key];
            if (isOutlier(numVal, mean, std)) {
              newRow[`${key}_FLAG`] = "OUTLIER";
              outliersFlagged++;
            }
          }

          // GPS Validation
          if (lowerKey === 'latitude' || lowerKey === 'lat') {
            const lat = Number(val);
            if (isNaN(lat) || lat < -90 || lat > 90) {
              newRow[key] = null; // Mark for manual review or zero
              gpsErrorsFixed++;
            }
          }
          if (lowerKey === 'longitude' || lowerKey === 'long' || lowerKey === 'lng') {
            const lng = Number(val);
            if (isNaN(lng) || lng < -180 || lng > 180) {
              newRow[key] = null;
              gpsErrorsFixed++;
            }
          }

          // Date Reformatter
          // Heuristic for date columns
          if (lowerKey.includes('date') || lowerKey.includes('time')) {
            const dateFormats = ['MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd', 'MM-dd-yyyy', 'dd-MM-yyyy'];
            let parsedDate = null;
            
            if (val instanceof Date) {
              parsedDate = val;
            } else if (typeof val === 'string') {
              for (const fmt of dateFormats) {
                const d = parse(val, fmt, new Date());
                if (isValid(d)) {
                  parsedDate = d;
                  break;
                }
              }
            }

            if (parsedDate) {
              newRow[key] = format(parsedDate, 'yyyy-MM-dd');
              datesReformatted++;
            }
          }
        });

        return newRow;
      });

      setCleanData(sanitized);
      setStats({
        rowsProcessed: sanitized.length,
        duplicatesRemoved,
        missingValuesFilled,
        outliersFlagged,
        gpsErrorsFixed,
        datesReformatted
      });
      setIsCleaning(false);
    }, 1500);
  }, [rawData]);

  const downloadData = () => {
    if (!cleanData) return;
    const ws = XLSX.utils.json_to_sheet(cleanData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sanitized Data");
    XLSX.writeFile(wb, `Sanitized_${fileName.replace(/\.[^/.]+$/, "")}.xlsx`);
  };

  const handlePayment = (method: string) => {
    if (method === 'Visa') {
      setPaymentStep('card');
      return;
    }

    if (method === 'Paystack') {
      const publicKey = paystackKeys.public || (import.meta as any).env.VITE_PAYSTACK_PUBLIC_KEY;
      if (!publicKey) {
        alert("Paystack Public Key not found. Please configure it in your environment variables (VITE_PAYSTACK_PUBLIC_KEY).");
        return;
      }
      
      if (!user) {
        alert("Please sign in to complete your purchase.");
        setShowAuth('signin');
        return;
      }

      try {
        // For Kenyan accounts, it's often best to charge in KES.
        // We convert the USD price to KES using a standard rate (e.g., 1 USD = 130 KES)
        const exchangeRate = 130; 
        const amountInUSD = selectedPlan === 'Pro Subscription' ? 150 : selectedPlan === 'Freemium' ? 2 : 49;
        const amountInKES = amountInUSD * exchangeRate * 100; // Amount in cents (KES)

        const handler = (window as any).PaystackPop.setup({
          key: publicKey,
          email: user.email,
          amount: amountInKES,
          currency: 'KES', // Charging in KES ensures compatibility with Kenyan merchant accounts
          callback: (response: any) => {
            console.log("Payment successful", response);
            setIsProcessingPayment(true);
            setTimeout(() => {
              setIsProcessingPayment(false);
              setPaymentSuccess(true);
              setActivePlan(selectedPlan === 'Pro Subscription' ? 'pro' : 'pay-per-use');
              setTimeout(() => {
                setPaymentSuccess(false);
                setShowPayment(false);
              }, 3000);
            }, 1000);
          },
          onClose: () => {
            alert('Transaction was not completed, window closed.');
          }
        });
        handler.openIframe();
        return; // Exit early as Paystack handles the flow
      } catch (error) {
        console.error("Paystack initialization failed", error);
        alert("Could not initialize Paystack. Please check your Public Key.");
      }
    }

    if (method === 'PayPal') {
      setPaymentStep('paypal');
      return;
    }

    setIsProcessingPayment(true);
    
    // Simulate a payment gateway processing
    setTimeout(() => {
      setIsProcessingPayment(false);
      setPaymentSuccess(true);
      setActivePlan(selectedPlan === 'Pro Subscription' ? 'pro' : 'pay-per-use');
      
      // Reset after 3 seconds
      setTimeout(() => {
        setPaymentSuccess(false);
        setShowPayment(false);
      }, 3000);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100 relative overflow-x-hidden">
      {/* Background Decorations */}
      <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-transparent to-indigo-50/30" />
        
        {/* Floating Data Images */}
        <motion.div 
          animate={{ 
            y: [0, -20, 0],
            rotate: [0, 5, 0]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-[10%] -left-20 w-[400px] h-[400px] opacity-[0.03] blur-sm"
        >
          <img 
            src="https://picsum.photos/seed/data1/800/800" 
            alt="" 
            className="w-full h-full object-cover rounded-full grayscale"
            referrerPolicy="no-referrer"
          />
        </motion.div>

        <motion.div 
          animate={{ 
            y: [0, 30, 0],
            rotate: [0, -10, 0]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-[10%] -right-20 w-[500px] h-[500px] opacity-[0.04] blur-md"
        >
          <img 
            src="https://picsum.photos/seed/analytics/1000/1000" 
            alt="" 
            className="w-full h-full object-cover rounded-full grayscale"
            referrerPolicy="no-referrer"
          />
        </motion.div>

        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.02, 0.05, 0.02]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[40%] left-[20%] w-[300px] h-[300px] opacity-[0.02] blur-xl"
        >
          <img 
            src="https://picsum.photos/seed/grid/600/600" 
            alt="" 
            className="w-full h-full object-cover rounded-full grayscale"
            referrerPolicy="no-referrer"
          />
        </motion.div>
      </div>

      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <svg viewBox="0 0 24 24" className="w-8 h-8 fill-current" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="4" r="2" />
                <path d="M10 7L4 22H8L11 14L10 7Z" />
                <path d="M14 7L20 22H16L13 14L14 7Z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-4xl tracking-tight">Survey Sanitizer</h1>
              <p className="text-sm text-zinc-500 uppercase tracking-[0.2em] font-bold">Data Cleaning Pro</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm font-medium text-zinc-600 hover:text-blue-600 transition-colors">Features</a>
            <a href="#pricing" className="text-sm font-medium text-zinc-600 hover:text-blue-600 transition-colors">Pricing</a>
            {user ? (
              <div className="flex items-center gap-4">
                {user.email === 'ascendempower@gmail.com' && (
                  <button 
                    onClick={fetchAdminData}
                    className="text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Admin Dashboard
                  </button>
                )}
                <span className="text-sm text-zinc-500 font-medium">{user.email}</span>
                <button 
                  onClick={() => {
                    setUser(null);
                    setActivePlan('freemium');
                    setUploadCount(0);
                    localStorage.clear();
                  }}
                  className="text-sm font-semibold text-red-500 hover:text-red-600 transition-colors"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowAuth('signin')}
                  className="text-sm font-semibold text-zinc-600 hover:text-blue-600 transition-colors"
                >
                  Sign In
                </button>
                <button 
                  onClick={() => setShowAuth('signup')}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-all shadow-md active:scale-95"
                >
                  Create Account
                </button>
              </div>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <section className="text-center mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl lg:text-7xl font-extrabold mb-6 tracking-tight"
          >
            Clean Survey Data in <span className="text-blue-600">Seconds.</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-zinc-500 max-w-2xl mx-auto text-lg"
          >
            The ultimate toolkit for researchers, statisticians, M&E practitioners, data managers and related professionals. Standardize cases, fix GPS errors, detect outliers, and remove duplicates with one click.
          </motion.p>
        </section>

        {/* Upload Area */}
        <section className="mb-12">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-1">Upload Survey Data (Microsoft Excel or Access files)</h2>
              <p className="text-zinc-500 text-sm">Supported formats: .xlsx, .csv</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-100 rounded-full">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">
                  Plan: {activePlan === 'freemium' ? 'Freemium' : activePlan === 'pro' ? 'Pro Subscription' : 'Pay-Per-Use'}
                </span>
              </div>
              {activePlan === 'freemium' && (
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  Uploads: {uploadCount} / 5
                </span>
              )}
            </div>
          </div>
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-3xl p-12 transition-all cursor-pointer flex flex-col items-center justify-center gap-4",
              rawData ? "border-blue-200 bg-blue-50/30" : "border-zinc-200 bg-white hover:border-blue-400 hover:bg-blue-50/10"
            )}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".csv,.xlsx" 
              className="hidden" 
            />
            {rawData ? (
              <>
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                  <CheckCircle2 size={32} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-xl">{fileName}</p>
                  <p className="text-zinc-500">{rawData.length} rows detected</p>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setRawData(null);
                    setCleanData(null);
                    setFileName('');
                  }}
                  className="text-red-500 text-sm font-medium hover:underline flex items-center gap-1"
                >
                  <Trash2 size={14} /> Remove file
                </button>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-400">
                  <Upload size={32} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-xl">Upload Survey Data</p>
                  <p className="text-zinc-500">Drag & drop or click to browse (.xlsx, .csv)</p>
                </div>
              </>
            )}
          </div>

          {rawData && !cleanData && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-8 flex flex-col items-center gap-4"
            >
              {activePlan === 'freemium' && rawData.length > 50 && (
                <div className="bg-amber-50 border border-amber-200 p-6 rounded-[32px] text-amber-800 text-sm flex flex-col items-center gap-4 max-w-md text-center shadow-sm">
                  <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600">
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <p className="font-bold text-base mb-1">File Limit Exceeded</p>
                    <p className="opacity-80">Your file has <strong>{rawData.length} rows</strong>. The Freemium plan only supports up to 50 rows.</p>
                  </div>
                  <div className="flex gap-3 w-full">
                    {!user ? (
                      <button 
                        onClick={() => setShowAuth('signin')}
                        className="flex-1 bg-amber-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-amber-700 transition-all"
                      >
                        Sign In to Upgrade
                      </button>
                    ) : (
                      <button 
                        onClick={() => setShowPayment(true)}
                        className="flex-1 bg-amber-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-amber-700 transition-all"
                      >
                        Upgrade Plan
                      </button>
                    )}
                  </div>
                </div>
              )}
              
              <button 
                onClick={sanitizeData}
                disabled={isCleaning || (activePlan === 'freemium' && rawData.length > 50)}
                className="bg-[#1A1A1A] text-white px-10 py-5 rounded-[24px] font-bold text-xl flex items-center gap-3 hover:bg-zinc-800 transition-all shadow-2xl shadow-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
              >
                {isCleaning ? (
                  <>
                    <RefreshCw className="animate-spin" size={24} />
                    Sanitizing...
                  </>
                ) : (
                  <>
                    <Zap size={24} className="text-blue-400 fill-blue-400" />
                    Sanitize Now
                  </>
                )}
              </button>
            </motion.div>
          )}
        </section>

        {/* Results Section */}
        <AnimatePresence>
          {cleanData && stats && (
            <motion.section 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-12"
            >
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {[
                  { label: 'Processed', value: stats.rowsProcessed, icon: Globe, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Duplicates', value: stats.duplicatesRemoved, icon: Trash2, color: 'text-red-600', bg: 'bg-red-50' },
                  { label: 'Missing Fixed', value: stats.missingValuesFilled, icon: Info, color: 'text-amber-600', bg: 'bg-amber-50' },
                  { label: 'Outliers', value: stats.outliersFlagged, icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50' },
                  { label: 'GPS Fixed', value: stats.gpsErrorsFixed, icon: Globe, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Dates Fixed', value: stats.datesReformatted, icon: RefreshCw, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                ].map((stat, i) => (
                  <div key={i} className={cn("p-4 rounded-2xl border border-zinc-100 bg-white shadow-sm", stat.bg)}>
                    <stat.icon size={20} className={cn("mb-2", stat.color)} />
                    <p className="text-2xl font-black">{stat.value}</p>
                    <p className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Preview Comparison */}
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h3 className="font-bold flex items-center gap-2 text-zinc-500">
                    <AlertTriangle size={18} /> Before (Raw)
                  </h3>
                  <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto max-h-[400px]">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0">
                          <tr>
                            {Object.keys(rawData![0] || {}).slice(0, 5).map(k => (
                              <th key={k} className="px-4 py-3 font-semibold text-zinc-600">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {rawData!.slice(0, 10).map((row, i) => (
                            <tr key={i}>
                              {Object.values(row).slice(0, 5).map((v, j) => (
                                <td key={j} className="px-4 py-3 text-zinc-500 truncate max-w-[150px]">{String(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-bold flex items-center gap-2 text-blue-600">
                    <CheckCircle2 size={18} /> After (Sanitized)
                  </h3>
                  <div className="bg-white border border-blue-100 rounded-2xl overflow-hidden shadow-lg shadow-blue-50">
                    <div className="overflow-x-auto max-h-[400px]">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-blue-50 border-b border-blue-100 sticky top-0">
                          <tr>
                            {Object.keys(cleanData![0] || {}).slice(0, 5).map(k => (
                              <th key={k} className="px-4 py-3 font-semibold text-blue-800">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-50">
                          {cleanData!.slice(0, 10).map((row, i) => (
                            <tr key={i}>
                              {Object.entries(row).slice(0, 5).map(([k, v], j) => (
                                <td key={j} className={cn(
                                  "px-4 py-3 truncate max-w-[150px]",
                                  row[`${k}_FLAG`] === 'OUTLIER' ? "bg-red-50 text-red-600 font-bold" : "text-blue-900"
                                )}>
                                  {String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              {/* Download Action */}
              <div className="flex flex-col items-center gap-4">
                <button 
                  onClick={downloadData}
                  className="bg-blue-600 text-white px-10 py-5 rounded-2xl font-black text-xl flex items-center gap-3 hover:bg-blue-700 transition-all shadow-2xl shadow-blue-200 active:scale-95"
                >
                  <Download size={28} />
                  Download Cleaned Data
                </button>
                <p className="text-zinc-400 text-sm flex items-center gap-2">
                  <FileSpreadsheet size={16} /> Exported as .xlsx with outlier flags
                </p>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Features Section */}
        <section id="features" className="mt-32 scroll-mt-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Fast Data Cleaning Features</h2>
            <p className="text-zinc-500 max-w-2xl mx-auto">Everything you need to ensure your survey data is accurate, consistent, and ready for analysis.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "Case Standardization",
                description: "Automatically converts 'Name' and 'Location' columns to Proper Case for consistent reporting.",
                icon: Info,
                color: "text-blue-600",
                bg: "bg-blue-50"
              },
              {
                title: "Missing Data Handler",
                description: "Intelligently fills blank cells: 0 for numeric columns and 'Not Provided' for text fields.",
                icon: RefreshCw,
                color: "text-amber-600",
                bg: "bg-amber-50"
              },
              {
                title: "Outlier Detection",
                description: "Statistical flagging of values 3+ standard deviations from the mean (e.g., household size of 99).",
                icon: AlertTriangle,
                color: "text-rose-600",
                bg: "bg-rose-50"
              },
              {
                title: "GPS Validation",
                description: "Validates latitude (-90 to 90) and longitude (-180 to 180) to ensure spatial accuracy.",
                icon: Globe,
                color: "text-indigo-600",
                bg: "bg-indigo-50"
              },
              {
                title: "Deduplication",
                description: "Removes exact duplicate rows based on Unique ID or Phone Number to prevent double-counting.",
                icon: Trash2,
                color: "text-red-600",
                bg: "bg-red-50"
              },
              {
                title: "Date Reformatter",
                description: "Standardizes all date formats to ISO YYYY-MM-DD for seamless database integration.",
                icon: CheckCircle2,
                color: "text-emerald-600",
                bg: "bg-emerald-50"
              }
            ].map((feature, i) => (
              <motion.div 
                key={i}
                whileHover={{ y: -5 }}
                className="p-8 rounded-3xl border border-zinc-100 bg-white shadow-sm hover:shadow-md transition-all"
              >
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-6", feature.bg, feature.color)}>
                  <feature.icon size={24} />
                </div>
                <h3 className="font-bold text-xl mb-3">{feature.title}</h3>
                <p className="text-zinc-500 text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="mt-32 scroll-mt-24">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-2">Simple, Transparent Pricing</h2>
            <p className="text-zinc-500">Choose the plan that fits your data caseload</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {PLANS.map((plan) => (
              <div 
                key={plan.id}
                className={cn(
                  "relative p-8 rounded-3xl border transition-all flex flex-col",
                  plan.recommended 
                    ? "border-blue-500 bg-white shadow-2xl scale-105 z-10" 
                    : "border-zinc-200 bg-zinc-50 hover:bg-white"
                )}
              >
                {plan.recommended && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="font-bold text-xl mb-1">{plan.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black">{plan.price}</span>
                    <span className="text-zinc-500 text-sm">{plan.period}</span>
                  </div>
                </div>
                <p className="text-sm text-zinc-600 mb-6 italic">"{plan.bestFor}"</p>
                <ul className="space-y-4 mb-8 flex-grow">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <CheckCircle2 size={18} className="text-blue-500 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <button 
                  onClick={() => {
                    setSelectedPlan(plan.name);
                    setShowPayment(true);
                  }}
                  className={cn(
                    "w-full py-4 rounded-xl font-bold transition-all active:scale-95",
                    plan.recommended 
                      ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-100" 
                      : "bg-white border border-zinc-300 text-zinc-800 hover:border-blue-500 hover:text-blue-600"
                  )}
                >
                  Get Started
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[#1A1A1A] text-white py-20 mt-32">
        <div className="max-w-7xl mx-auto px-4 grid md:grid-cols-4 gap-12">
          <div className="col-span-2">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
                <svg viewBox="0 0 24 24" className="w-10 h-10 fill-current" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="4" r="2" />
                  <path d="M10 7L4 22H8L11 14L10 7Z" />
                  <path d="M14 7L20 22H16L13 14L14 7Z" />
                </svg>
              </div>
              <h2 className="text-5xl font-bold tracking-tight">Survey Sanitizer</h2>
            </div>
            <p className="text-zinc-400 max-w-sm">
              Built specifically for researchers, data and M&E professionals. 
              Ensuring data integrity for NGOs, UN agencies, government agencies, students and independent researchers worldwide.
            </p>
          </div>
          <div>
            <h4 className="font-bold mb-6 text-blue-500 uppercase text-xs tracking-widest">Product</h4>
            <ul className="space-y-4 text-zinc-400 text-sm">
              <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
              <li><button onClick={() => setShowSecurity(true)} className="hover:text-white transition-colors">Security</button></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-6 text-blue-500 uppercase text-xs tracking-widest">Connect</h4>
            <ul className="space-y-4 text-zinc-400 text-sm">
              <li><a href="mailto:contact@ascendempower.com" className="hover:text-white transition-colors">Support: contact@ascendempower.com</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Twitter</a></li>
              <li><a href="#" className="hover:text-white transition-colors">LinkedIn</a></li>
              <li><a href="mailto:contact@ascendempower.com" className="hover:text-white transition-colors">Contact: contact@ascendempower.com</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 mt-20 pt-8 border-t border-zinc-800 flex flex-col md:flex-row justify-between items-center gap-4 text-zinc-500 text-sm">
          <p>© 2026 Ascend Empowerment Solutions. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <button onClick={() => setShowPrivacy(true)} className="hover:text-white transition-colors">Privacy Policy</button>
            <button onClick={() => setShowTerms(true)} className="hover:text-white transition-colors">Terms of Service</button>
          </div>
        </div>
      </footer>

      {/* Payment Modal */}
      <AnimatePresence>
        {showPayment && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPayment(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-[32px] shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
            >
              <div className="p-8 overflow-y-auto">
                {paymentSuccess ? (
                  <div className="text-center py-12">
                    <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <CheckCircle2 size={48} />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">Payment Successful!</h3>
                    <p className="text-zinc-500">Your account has been upgraded to {selectedPlan}.</p>
                  </div>
                ) : isProcessingPayment ? (
                  <div className="text-center py-12">
                    <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                      <RefreshCw size={48} className="animate-spin" />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">Processing...</h3>
                    <p className="text-zinc-500">Connecting to secure payment gateway</p>
                  </div>
                ) : paymentStep === 'card' ? (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center mb-6">
                      <button 
                        onClick={() => setPaymentStep('options')}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <ChevronRight size={16} className="rotate-180" /> Back
                      </button>
                      <h3 className="text-xl font-bold">Card Details</h3>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5 ml-1">Card Number</label>
                        <div className="relative">
                          <input 
                            type="text" 
                            placeholder="0000 0000 0000 0000"
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-sm font-mono"
                          />
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
                            <div className="w-8 h-5 bg-zinc-100 rounded border border-zinc-200" />
                            <div className="w-8 h-5 bg-zinc-100 rounded border border-zinc-200" />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5 ml-1">Expiry Date</label>
                          <input 
                            type="text" 
                            placeholder="MM / YY"
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-sm font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5 ml-1">CVC</label>
                          <input 
                            type="text" 
                            placeholder="123"
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-sm font-mono"
                          />
                        </div>
                      </div>

                      <button 
                        onClick={() => {
                          setIsProcessingPayment(true);
                          setTimeout(() => {
                            setIsProcessingPayment(false);
                            setPaymentSuccess(true);
                            setActivePlan(selectedPlan === 'Pro Subscription' ? 'pro' : 'pay-per-use');
                            setTimeout(() => {
                              setPaymentSuccess(false);
                              setShowPayment(false);
                              setPaymentStep('options');
                            }, 3000);
                          }, 2000);
                        }}
                        className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-95 mt-4"
                      >
                        Pay {selectedPlan === 'Pro Subscription' ? '$150.00' : '$49.00'}
                      </button>
                    </div>

                    <p className="text-[10px] text-zinc-400 text-center mt-4">
                      Your payment is secured with 256-bit encryption. We do not store your card details.
                    </p>
                  </div>
                ) : paymentStep === 'paypal' ? (
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 mb-6">
                      <button 
                        onClick={() => setPaymentStep('options')}
                        className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                      >
                        <ChevronRight className="rotate-180" size={20} />
                      </button>
                      <h3 className="text-2xl font-bold">PayPal Checkout</h3>
                    </div>
                    
                    <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 mb-6">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-blue-900">Selected Plan:</span>
                        <span className="font-bold text-blue-900">{selectedPlan}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-blue-900">Total Amount:</span>
                        <span className="text-xl font-black text-blue-900">
                          {selectedPlan === 'Pro Subscription' ? '$150.00' : selectedPlan === 'Freemium' ? '$2.00' : '$49.00'}
                        </span>
                      </div>
                    </div>

                    <PayPalButton 
                      amount={selectedPlan === 'Pro Subscription' ? '150.00' : selectedPlan === 'Freemium' ? '2.00' : '49.00'}
                      onSuccess={() => {
                        setIsProcessingPayment(true);
                        setTimeout(() => {
                          setIsProcessingPayment(false);
                          setPaymentSuccess(true);
                          setActivePlan(selectedPlan === 'Pro Subscription' ? 'pro' : 'pay-per-use');
                          setTimeout(() => {
                            setPaymentSuccess(false);
                            setShowPayment(false);
                            setPaymentStep('options');
                          }, 3000);
                        }, 1000);
                      }}
                      onCancel={() => {
                        setPaymentStep('options');
                      }}
                    />
                    
                    <p className="text-[10px] text-zinc-400 text-center">
                      You will be redirected to PayPal to complete your purchase securely.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-8">
                      <div>
                        <h3 className="text-2xl font-bold">Complete Payment</h3>
                        <p className="text-zinc-500">Secure checkout for {selectedPlan || 'Pro'}</p>
                      </div>
                      <button 
                        onClick={() => setShowPayment(false)}
                        className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <button 
                        onClick={() => handlePayment('Paystack')}
                        className="w-full p-6 rounded-2xl border border-zinc-200 flex items-center justify-between hover:border-blue-500 hover:bg-blue-50/30 transition-all group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-8 bg-zinc-100 rounded flex items-center justify-center">
                            <Zap size={20} className="text-blue-500 fill-blue-500" />
                          </div>
                          <div className="text-left">
                            <span className="font-bold block">Paystack</span>
                            <span className="text-[10px] text-zinc-500 leading-tight block mt-0.5">
                              (Supports Visa, Mastercard, American Express and Mobile Money options like MPESA, Pesalink, Airtel Money)
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={20} className="text-zinc-300 group-hover:text-blue-500" />
                      </button>

                      <button 
                        onClick={() => handlePayment('PayPal')}
                        className="w-full p-6 rounded-2xl border border-zinc-200 flex items-center justify-between hover:border-blue-500 hover:bg-blue-50/30 transition-all group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-8 bg-zinc-100 rounded flex items-center justify-center">
                            <Globe size={20} className="text-blue-700" />
                          </div>
                          <span className="font-bold">PayPal</span>
                        </div>
                        <ChevronRight size={20} className="text-zinc-300 group-hover:text-blue-500" />
                      </button>
                    </div>

                    <div className="mt-8 pt-8 border-t border-zinc-100 text-center">
                      <p className="text-xs text-zinc-400 flex items-center justify-center gap-2">
                        <ShieldCheck size={14} /> 256-bit SSL Secure Payment
                      </p>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Privacy Policy Modal */}
      <AnimatePresence>
        {showPrivacy && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPrivacy(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-[32px] overflow-hidden shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="p-8 overflow-y-auto">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="text-2xl font-bold">Privacy Policy</h3>
                  <button onClick={() => setShowPrivacy(false)} className="text-zinc-400 hover:text-zinc-600">
                    <Trash2 size={20} />
                  </button>
                </div>
                <div className="prose prose-sm text-zinc-600 space-y-4">
                  <p><strong>Last Updated: February 22, 2026</strong></p>
                  <p>At Ascend Empowerment Solutions, we are committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our Survey Sanitizer application.</p>
                  <h4 className="font-bold text-zinc-800">1. Zero-Server Storage Policy</h4>
                  <p className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-blue-900">
                    <strong>Crucial:</strong> We do NOT capture, upload, or store your survey data on any server. All data processing occurs locally within your browser's memory. Once you close the tab or refresh the page, the processed data is cleared from memory.
                  </p>
                  <h4 className="font-bold text-zinc-800">2. Information We Retain</h4>
                  <p>To provide our services, we retain minimal metadata in your browser's Local Storage:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Your account email (for authentication)</li>
                    <li>Your current subscription plan status</li>
                    <li>Your total upload count (to enforce plan limits)</li>
                  </ul>
                  <h4 className="font-bold text-zinc-800">3. Data Security</h4>
                  <p>We implement industry-standard security measures to protect your metadata. Since your survey data never leaves your device, it is inherently protected from server-side breaches.</p>
                  <h4 className="font-bold text-zinc-800">4. Third-Party Services</h4>
                  <p>We use third-party payment processors (Paystack, PayPal). Their use of your personal information is governed by their respective privacy policies.</p>
                  <h4 className="font-bold text-zinc-800">5. Contact Us</h4>
                  <p>If you have any questions about this Privacy Policy, please contact us at <a href="mailto:contact@ascendempower.com" className="text-blue-600 underline">contact@ascendempower.com</a>.</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Security Modal */}
      <AnimatePresence>
        {showSecurity && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSecurity(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-[32px] overflow-hidden shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="p-8 overflow-y-auto">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="text-2xl font-bold flex items-center gap-2">
                    <ShieldCheck className="text-blue-600" /> Security & Data Integrity
                  </h3>
                  <button onClick={() => setShowSecurity(false)} className="text-zinc-400 hover:text-zinc-600">
                    <Trash2 size={20} />
                  </button>
                </div>
                <div className="prose prose-sm text-zinc-600 space-y-6">
                  <section className="bg-zinc-50 p-6 rounded-2xl border border-zinc-100">
                    <h4 className="font-bold text-zinc-800 mb-2">Local-First Processing</h4>
                    <p>Survey Sanitizer is built on a "Local-First" architecture. This means your data is processed entirely within your browser's memory (RAM). We do not have a backend server that receives or stores your uploaded files.</p>
                  </section>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 border border-zinc-100 rounded-xl">
                      <h5 className="font-bold text-zinc-800 mb-1">What we DON'T store:</h5>
                      <ul className="list-disc pl-5 space-y-1 text-xs">
                        <li>Uploaded CSV/Excel files</li>
                        <li>Cleaned survey results</li>
                        <li>Personally Identifiable Information (PII) from your data</li>
                      </ul>
                    </div>
                    <div className="p-4 border border-zinc-100 rounded-xl">
                      <h5 className="font-bold text-zinc-800 mb-1">What we DO retain:</h5>
                      <ul className="list-disc pl-5 space-y-1 text-xs">
                        <li>Account Email (for login)</li>
                        <li>Subscription Tier (Freemium/Pro)</li>
                        <li>Usage counter (Upload count)</li>
                      </ul>
                    </div>
                  </div>

                  <section>
                    <h4 className="font-bold text-zinc-800">Encryption & Payments</h4>
                    <p>All interactions with our site are protected by 256-bit SSL encryption. Payments are handled exclusively by Paystack and PayPal, ensuring your financial data never touches our systems.</p>
                  </section>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Terms & Conditions Modal */}
      <AnimatePresence>
        {showTerms && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTerms(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-[32px] overflow-hidden shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="p-8 overflow-y-auto">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="text-2xl font-bold">Terms & Conditions</h3>
                  <button onClick={() => setShowTerms(false)} className="text-zinc-400 hover:text-zinc-600">
                    <Trash2 size={20} />
                  </button>
                </div>
                <div className="prose prose-sm text-zinc-600 space-y-4">
                  <p><strong>Last Updated: February 22, 2026</strong></p>
                  <p>By using Survey Sanitizer, you agree to the following terms and conditions.</p>
                  <h4 className="font-bold text-zinc-800">1. Local Data Processing</h4>
                  <p>Survey Sanitizer processes all survey data locally in your browser. You retain full ownership and control of your data. We do not store, view, or share your uploaded survey files.</p>
                  <h4 className="font-bold text-zinc-800">2. User Responsibility</h4>
                  <p>You are responsible for the accuracy and legality of the data you process. You must ensure you have the necessary permissions to clean and handle the data uploaded to the tool.</p>
                  <h4 className="font-bold text-zinc-800">3. Subscriptions and Payments</h4>
                  <p>Paid plans are billed in advance. All payments are non-refundable unless required by law. We reserve the right to change our pricing with notice.</p>
                  <h4 className="font-bold text-zinc-800">4. Limitation of Liability</h4>
                  <p>Survey Sanitizer is provided "as is" without any warranties. Ascend Empowerment Solutions shall not be liable for any data loss, inaccuracies, or damages arising from the use of this tool.</p>
                  <h4 className="font-bold text-zinc-800">5. Intellectual Property</h4>
                  <p>The application, including its code, design, and logo, is the property of Ascend Empowerment Solutions.</p>
                  <h4 className="font-bold text-zinc-800">6. Governing Law</h4>
                  <p>These terms shall be governed by and construed in accordance with international business standards. Any disputes shall be resolved through binding arbitration.</p>
                  <h4 className="font-bold text-zinc-800">7. Contact</h4>
                  <p>For any questions regarding these terms, please contact <a href="mailto:contact@ascendempower.com" className="text-blue-600 underline">contact@ascendempower.com</a>.</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Dashboard Modal */}
      <AnimatePresence>
        {showAdmin && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdmin(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-4xl rounded-[32px] overflow-hidden shadow-2xl max-h-[85vh] flex flex-col"
            >
              <div className="p-8 overflow-y-auto">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h3 className="text-2xl font-bold">Admin Dashboard</h3>
                    <p className="text-zinc-500 text-sm">User directory and usage statistics</p>
                  </div>
                  <button onClick={() => setShowAdmin(false)} className="text-zinc-400 hover:text-zinc-600">
                    <Trash2 size={24} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-zinc-400">User</th>
                        <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-zinc-400">Country</th>
                        <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-zinc-400">Plan</th>
                        <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-zinc-400 text-center">Uploads</th>
                        <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-zinc-400">Last Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.map((u) => (
                        <tr key={u.id} className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors">
                          <td className="py-4 px-4 font-medium">{u.email}</td>
                          <td className="py-4 px-4 text-zinc-600">{u.country}</td>
                          <td className="py-4 px-4">
                            <span className={cn(
                              "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              u.plan === 'pro' ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"
                            )}>
                              {u.plan}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-center font-mono font-bold text-blue-600">{u.upload_count}</td>
                          <td className="py-4 px-4 text-zinc-400 text-xs">
                            {new Date(u.last_active).toLocaleDateString()} {new Date(u.last_active).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuth && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuth(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex justify-between items-start mb-8">
                  <h3 className="text-2xl font-bold">
                    {showAuth === 'signin' ? 'Welcome Back' : 'Create Account'}
                  </h3>
                  <button onClick={() => setShowAuth(null)} className="text-zinc-400 hover:text-zinc-600">
                    <Trash2 size={20} />
                  </button>
                </div>

                <form className="space-y-4" onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  handleAuth(formData.get('email') as string);
                }}>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5 ml-1">Email Address</label>
                    <input 
                      name="email"
                      type="email" 
                      required
                      placeholder="name@company.com"
                      className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5 ml-1">Password</label>
                    <input 
                      name="password"
                      type="password" 
                      required
                      placeholder="••••••••"
                      className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-sm"
                    />
                  </div>
                  <button 
                    type="submit"
                    className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-95"
                  >
                    {showAuth === 'signin' ? 'Sign In' : 'Create Account'}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button 
                    onClick={() => setShowAuth(showAuth === 'signin' ? 'signup' : 'signin')}
                    className="text-sm text-zinc-500 hover:text-blue-600 transition-colors"
                  >
                    {showAuth === 'signin' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
