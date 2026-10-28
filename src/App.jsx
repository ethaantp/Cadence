import React, { useState, useEffect, useMemo } from 'react';
import {
  Cat,
  Sun,
  Moon,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  Droplets,
  UserCheck,
  Plus,
  Settings,
  History,
  ShieldAlert,
  Sparkles,
  Edit3,
  Trash2,
  RefreshCw,
  Wifi,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
  Check
} from 'lucide-react';

// ==========================================
// LOCAL DEVICE SESSION & POLLING CONFIG
// ==========================================
const POLL_INTERVAL_MS = 2500;
const DEVICE_ID_STORAGE_KEY = 'cadence-device-id';

const getOrCreateDeviceId = () => {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `device-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'local-household-device';
  }
};

// ==========================================
// DATE & TIME UTILITIES
// ==========================================
const getLocalDateKey = (dateObj = new Date()) => {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatTimeDisplay = (isoString) => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const formatReadableDate = (dateKey, todayKey) => {
  if (dateKey === todayKey) return 'Today';
  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === getLocalDateKey(yesterday)) return 'Yesterday';

  return dateObj.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
};

const parseLocalDateKey = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const getMondayOfWeek = (dateInput = new Date()) => {
  const d =
    typeof dateInput === 'string' ? parseLocalDateKey(dateInput) : new Date(dateInput);
  const dayOfWeek = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diffToMonday);
  return getLocalDateKey(d);
};

const shiftDateKeyByDays = (dateKey, deltaDays) => {
  const d = parseLocalDateKey(dateKey);
  d.setDate(d.getDate() + deltaDays);
  return getLocalDateKey(d);
};

const getCalendarWeekDays = (mondayKey, todayKey) => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dayKey = shiftDateKeyByDays(mondayKey, i);
    if (dayKey <= todayKey) {
      days.push(dayKey);
    }
  }
  return days.reverse();
};

const formatWeekRangeLabel = (mondayKey) => {
  const monDate = parseLocalDateKey(mondayKey);
  const sunDate = parseLocalDateKey(shiftDateKeyByDays(mondayKey, 6));
  const sameYear = monDate.getFullYear() === sunDate.getFullYear();
  const monStr = monDate.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  });
  const sunStr = sunDate.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  return `${monStr} – ${sunStr}`;
};

const getHoursSince = (isoString, nowMs) => {
  if (!isoString) return null;
  const diffMs = Math.max(0, nowMs - new Date(isoString).getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  if (totalMinutes === 0) return 'Just now';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m ago`;
  return `${hours}h ${minutes}m ago`;
};

const DEFAULT_SETTINGS = {
  catName: 'Mochi',
  medicationName: 'Oral Solution',
  dosageLabel: '2.5 mg / 0.5 ml',
  morningTargetTime: '08:00',
  eveningTargetTime: '20:00',
  bottleOpenedDate: getLocalDateKey(new Date()),
  bottleShelfLifeDays: 180, // Liquid oral solutions typically expire 6 months (180 days) after opening
  caregivers: ['Partner 1', 'Partner 2', 'Pet Sitter'],
  administrationNote: 'Give directly by mouth or with a small portion of food. Wipe syringe tip clean after each use.'
};

export default function App() {
  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [isDarkMode, setIsDarkMode] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  const [isConnected, setIsConnected] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [now, setNow] = useState(new Date());

  const toggleDarkMode = () => {
    const root = document.documentElement;
    const nextDark = !root.classList.contains('dark');
    root.classList.toggle('dark', nextDark);
    try {
      localStorage.setItem('cadence-theme', nextDark ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
    setIsDarkMode(nextDark);
  };

  // Local SQLite synced states
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [logsByDate, setLogsByDate] = useState({});
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Active caregiver & UI interaction states
  const [selectedCaregiver, setSelectedCaregiver] = useState('Partner 1');
  const [customCaregiverInput, setCustomCaregiverInput] = useState('');
  const [showAddCaregiver, setShowAddCaregiver] = useState(false);

  // Quick note input for today's dose
  const [morningNoteInput, setMorningNoteInput] = useState('');
  const [eveningNoteInput, setEveningNoteInput] = useState('');

  // Modals
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(DEFAULT_SETTINGS);
  const [confirmUndoModal, setConfirmUndoModal] = useState(null); // { dateKey, slot: 'morning' | 'evening', existingData }
  const [manualLogModal, setManualLogModal] = useState(null); // { dateKey, slot: 'morning' | 'evening', existingData }
  const [manualTimeInput, setManualTimeInput] = useState('08:00');
  const [manualCaregiverInput, setManualCaregiverInput] = useState('');
  const [manualNoteInput, setManualNoteInput] = useState('');
  const [showDeviceInfoModal, setShowDeviceInfoModal] = useState(false);

  // Keep clock fresh every 30 seconds for automatic midnight rollover & "time since last dose"
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // ==========================================
  // LOCAL SERVER POLLING SYNC (EVERY 2.5s)
  // ==========================================
  useEffect(() => {
    let isMounted = true;

    const fetchHouseholdState = async () => {
      try {
        const res = await fetch('/api/state', {
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!isMounted) return;

        const mergedSettings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        setSettings(mergedSettings);
        setSelectedCaregiver((prev) =>
          mergedSettings.caregivers &&
          mergedSettings.caregivers.length > 0 &&
          !mergedSettings.caregivers.includes(prev)
            ? mergedSettings.caregivers[0]
            : prev
        );
        setLogsByDate(data.logsByDate || {});
        setIsConnected(true);
        setIsLoadingData(false);
        setSyncError(null);
      } catch (err) {
        console.error('Local sync polling error:', err);
        if (!isMounted) return;
        setIsConnected(false);
        setIsLoadingData(false);
        setSyncError('Unable to reach local household server. Retrying...');
      }
    };

    fetchHouseholdState();

    const pollTimer = setInterval(fetchHouseholdState, POLL_INTERVAL_MS);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchHouseholdState();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, []);

  // ==========================================
  // COMPUTED DATA & STATUS CALCULATIONS
  // ==========================================
  const todayKey = useMemo(() => getLocalDateKey(now), [now]);
  const currentWeekMonday = useMemo(() => getMondayOfWeek(now), [now]);
  const [selectedWeekMonday, setSelectedWeekMonday] = useState(() =>
    getMondayOfWeek(new Date())
  );

  const activeWeekMonday =
    selectedWeekMonday > currentWeekMonday ? currentWeekMonday : selectedWeekMonday;
  const isCurrentWeek = activeWeekMonday === currentWeekMonday;

  const selectedWeekDays = useMemo(
    () => getCalendarWeekDays(activeWeekMonday, todayKey),
    [activeWeekMonday, todayKey]
  );
  const weekRangeLabel = useMemo(
    () => formatWeekRangeLabel(activeWeekMonday),
    [activeWeekMonday]
  );

  const todayLog = logsByDate[todayKey] || {};
  const morningDose = todayLog.morning || null;
  const eveningDose = todayLog.evening || null;

  // Determine the most recent dose given across all recorded history for "Time since last dose"
  const lastDoseInfo = useMemo(() => {
    const candidates = [];
    Object.keys(logsByDate).forEach((dKey) => {
      const dayRecord = logsByDate[dKey];
      if (!dayRecord) return;
      if (dayRecord.morning?.given && dayRecord.morning?.timestamp) {
        candidates.push({
          ...dayRecord.morning,
          slotLabel: 'Morning',
          dateKey: dKey
        });
      }
      if (dayRecord.evening?.given && dayRecord.evening?.timestamp) {
        candidates.push({
          ...dayRecord.evening,
          slotLabel: 'Evening',
          dateKey: dKey
        });
      }
    });

    candidates.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return candidates[0] || null;
  }, [logsByDate]);

  // Bottle expiration calculations
  const bottleStatus = useMemo(() => {
    const openedStr = settings.bottleOpenedDate || todayKey;
    const shelfLife = Number(settings.bottleShelfLifeDays) || 180;
    const [y, m, d] = openedStr.split('-').map(Number);
    const openedDate = new Date(y, m - 1, d);
    const expiryDate = new Date(y, m - 1, d);
    expiryDate.setDate(expiryDate.getDate() + shelfLife);

    const diffDaysOpen = Math.max(
      0,
      Math.floor((now.getTime() - openedDate.getTime()) / (1000 * 60 * 60 * 24))
    );
    const daysRemaining = Math.ceil(
      (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    const percentUsed = Math.min(100, Math.max(0, Math.round((diffDaysOpen / shelfLife) * 100)));

    return {
      openedDateFormatted: openedDate.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      expiryDateFormatted: expiryDate.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      diffDaysOpen,
      daysRemaining,
      percentUsed,
      isExpired: daysRemaining <= 0,
      isExpiringSoon: daysRemaining > 0 && daysRemaining <= 14
    };
  }, [settings.bottleOpenedDate, settings.bottleShelfLifeDays, now, todayKey]);

  // Selected week adherence metrics
  const adherenceStats = useMemo(() => {
    let completed = 0;
    let totalExpected = 0;

    selectedWeekDays.forEach((dKey) => {
      const record = logsByDate[dKey] || {};
      if (dKey === todayKey) {
        // For today, count slots already completed or due based on time of day
        const currentHour = now.getHours();
        const amExpected = currentHour >= 6 || record.morning?.given;
        const pmExpected = currentHour >= 17 || record.evening?.given;

        if (amExpected) totalExpected += 1;
        if (pmExpected) totalExpected += 1;
        if (record.morning?.given) completed += 1;
        if (record.evening?.given) completed += 1;
      } else {
        totalExpected += 2;
        if (record.morning?.given) completed += 1;
        if (record.evening?.given) completed += 1;
      }
    });

    const pct = totalExpected > 0 ? Math.round((completed / totalExpected) * 100) : 100;
    return { completed, totalExpected, pct };
  }, [selectedWeekDays, logsByDate, now, todayKey]);

  // ==========================================
  // LOCAL API WRITE ACTIONS
  // ==========================================
  const saveDayLogToApi = async (dateKey, payload) => {
    const res = await fetch(`/api/logs/${encodeURIComponent(dateKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data?.record) {
      setLogsByDate((prev) => ({ ...prev, [dateKey]: data.record }));
    }
    setIsConnected(true);
    setSyncError(null);
  };

  const saveSettingsToApi = async (updatedSettings) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedSettings)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data?.settings) {
      setSettings(data.settings);
    }
    setIsConnected(true);
    setSyncError(null);
  };

  const handleRecordDose = async (slot, customNote = '') => {
    const caregiverName = selectedCaregiver || 'Household Member';
    const timestampIso = new Date().toISOString();

    const dosePayload = {
      given: true,
      timestamp: timestampIso,
      givenBy: caregiverName,
      dosage: settings.dosageLabel,
      note: customNote.trim(),
      recordedByUid: deviceId
    };

    const currentDayData = logsByDate[todayKey] || { dateKey: todayKey };
    const updatedDayRecord = {
      ...currentDayData,
      dateKey: todayKey,
      [slot]: dosePayload,
      updatedAt: timestampIso
    };

    // Optimistic UI update
    setLogsByDate((prev) => ({ ...prev, [todayKey]: updatedDayRecord }));
    if (slot === 'morning') setMorningNoteInput('');
    if (slot === 'evening') setEveningNoteInput('');

    try {
      await saveDayLogToApi(todayKey, updatedDayRecord);
    } catch (err) {
      console.error('Error recording dose:', err);
      setSyncError('Failed to save dose to local server. Please check your Wi-Fi connection.');
    }
  };

  const handleConfirmUndoDose = async () => {
    if (!confirmUndoModal) return;
    const { dateKey, slot } = confirmUndoModal;
    const timestampIso = new Date().toISOString();

    const currentDayData = logsByDate[dateKey] || { dateKey };
    const updatedDayRecord = {
      ...currentDayData,
      dateKey,
      [slot]: null,
      updatedAt: timestampIso
    };

    // Optimistic UI update
    setLogsByDate((prev) => ({ ...prev, [dateKey]: updatedDayRecord }));
    setConfirmUndoModal(null);

    try {
      await saveDayLogToApi(dateKey, updatedDayRecord);
    } catch (err) {
      console.error('Error undoing dose:', err);
      setSyncError('Failed to undo dose record.');
    }
  };

  const openManualEntryModal = (dateKey, slot, existingData = null) => {
    let defaultTime = slot === 'morning' ? settings.morningTargetTime : settings.eveningTargetTime;
    if (existingData?.timestamp) {
      const d = new Date(existingData.timestamp);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      defaultTime = `${hh}:${mm}`;
    }
    setManualTimeInput(defaultTime || (slot === 'morning' ? '08:00' : '20:00'));
    setManualCaregiverInput(existingData?.givenBy || selectedCaregiver || 'Partner 1');
    setManualNoteInput(existingData?.note || '');
    setManualLogModal({ dateKey, slot, existingData });
  };

  const handleSaveManualEntry = async (e) => {
    e.preventDefault();
    if (!manualLogModal) return;

    const { dateKey, slot } = manualLogModal;
    const [year, month, day] = dateKey.split('-').map(Number);
    const [hours, minutes] = (manualTimeInput || '08:00').split(':').map(Number);
    const customDateObj = new Date(year, month - 1, day, hours || 0, minutes || 0, 0);

    const dosePayload = {
      given: true,
      timestamp: customDateObj.toISOString(),
      givenBy: manualCaregiverInput.trim() || selectedCaregiver || 'Household Member',
      dosage: settings.dosageLabel,
      note: manualNoteInput.trim(),
      recordedByUid: deviceId
    };

    const currentDayData = logsByDate[dateKey] || { dateKey };
    const updatedDayRecord = {
      ...currentDayData,
      dateKey,
      [slot]: dosePayload,
      updatedAt: new Date().toISOString()
    };

    // Optimistic UI update
    setLogsByDate((prev) => ({ ...prev, [dateKey]: updatedDayRecord }));
    setManualLogModal(null);

    try {
      await saveDayLogToApi(dateKey, updatedDayRecord);
    } catch (err) {
      console.error('Error saving manual dose entry:', err);
      setSyncError('Failed to save manual entry.');
    }
  };

  const handleAddCaregiver = async (e) => {
    e.preventDefault();
    const trimmed = customCaregiverInput.trim();
    if (!trimmed) return;

    const updatedCaregivers = Array.from(new Set([...(settings.caregivers || []), trimmed]));
    const updatedSettings = { ...settings, caregivers: updatedCaregivers };

    setSettings(updatedSettings);
    setSelectedCaregiver(trimmed);
    setCustomCaregiverInput('');
    setShowAddCaregiver(false);

    try {
      await saveSettingsToApi(updatedSettings);
    } catch (err) {
      console.error('Error adding caregiver:', err);
      setSyncError('Failed to save new caregiver.');
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const rawCaregivers =
      typeof settingsForm.caregiversText === 'string'
        ? settingsForm.caregiversText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : settingsForm.caregivers;
    const { caregiversText: _ignored, ...restForm } = settingsForm;
    const normalizedSettings = {
      ...restForm,
      caregivers:
        rawCaregivers && rawCaregivers.length > 0
          ? rawCaregivers
          : DEFAULT_SETTINGS.caregivers
    };
    setSettings(normalizedSettings);
    setSettingsModalOpen(false);

    try {
      await saveSettingsToApi(normalizedSettings);
    } catch (err) {
      console.error('Error saving settings:', err);
      setSyncError('Failed to update settings.');
    }
  };

  const handleOpenNewBottleToday = async () => {
    const updated = {
      ...settings,
      bottleOpenedDate: todayKey
    };
    setSettings(updated);
    setSettingsForm(updated);
    try {
      await saveSettingsToApi(updated);
    } catch (err) {
      console.error('Error resetting bottle date:', err);
      setSyncError('Failed to update bottle opened date.');
    }
  };

  // ==========================================
  // HERO BANNER STATUS LOGIC
  // ==========================================
  const statusBanner = useMemo(() => {
    const bothDone = morningDose?.given && eveningDose?.given;
    const onlyMorningDone = morningDose?.given && !eveningDose?.given;
    const onlyEveningDone = !morningDose?.given && eveningDose?.given;
    const currentHour = now.getHours();

    if (bothDone) {
      return {
        theme: 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-900/10',
        badgeTheme: 'bg-emerald-700/80 text-emerald-100',
        icon: <CheckCircle2 className="w-8 h-8 text-emerald-100 shrink-0" />,
        title: `All Done Today! Both of ${settings.catName}'s Doses Given`,
        subtitle: `Morning given at ${formatTimeDisplay(morningDose.timestamp)} (${morningDose.givenBy}) • Evening given at ${formatTimeDisplay(eveningDose.timestamp)} (${eveningDose.givenBy})`,
        warningText: 'DO NOT GIVE ANOTHER DOSE TODAY'
      };
    }

    if (onlyMorningDone) {
      const isEveningWindow = currentHour >= 17;
      return {
        theme: isEveningWindow
          ? 'bg-indigo-600 text-white border-indigo-500 shadow-indigo-900/10'
          : 'bg-teal-600 text-white border-teal-500 shadow-teal-900/10',
        badgeTheme: isEveningWindow
          ? 'bg-indigo-800/80 text-indigo-100'
          : 'bg-teal-800/80 text-teal-100',
        icon: isEveningWindow ? (
          <Moon className="w-8 h-8 text-amber-200 shrink-0" />
        ) : (
          <CheckCircle2 className="w-8 h-8 text-teal-100 shrink-0" />
        ),
        title: isEveningWindow
          ? `Morning Done • Ready for ${settings.catName}'s Evening Dose`
          : `Morning Dose Given! Waiting until Evening`,
        subtitle: `Morning dose (${settings.dosageLabel}) was given at ${formatTimeDisplay(morningDose.timestamp)} by ${morningDose.givenBy}.`,
        warningText: `MORNING DOSE ALREADY GIVEN — NEXT DOSE AT ~${settings.eveningTargetTime}`
      };
    }

    if (onlyEveningDone) {
      return {
        theme: 'bg-amber-600 text-white border-amber-500 shadow-amber-900/10',
        badgeTheme: 'bg-amber-800/80 text-amber-100',
        icon: <AlertTriangle className="w-8 h-8 text-amber-100 shrink-0" />,
        title: `Evening Dose Logged • Morning Dose Unchecked`,
        subtitle: `Evening dose was given at ${formatTimeDisplay(eveningDose.timestamp)} by ${eveningDose.givenBy}.`,
        warningText: 'EVENING DOSE ALREADY GIVEN TODAY'
      };
    }

    // Neither given yet today
    return {
      theme: 'bg-amber-500 text-slate-950 border-amber-400 shadow-amber-900/10',
      badgeTheme: 'bg-slate-900/15 text-slate-900',
      icon: <Sun className="w-8 h-8 text-slate-900 shrink-0" />,
      title: `No Doses Logged Yet Today for ${settings.catName}`,
      subtitle: `Target schedule: Morning (${settings.morningTargetTime}) & Evening (${settings.eveningTargetTime}) • Dosage: ${settings.dosageLabel}`,
      warningText: 'AWAITING MORNING DOSE'
    };
  }, [morningDose, eveningDose, settings, now]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-16 font-sans selection:bg-teal-500 selection:text-white">
      {/* ========================================== */}
      {/* TOP NAVIGATION & HOUSEHOLD SYNC BAR        */}
      {/* ========================================== */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white shadow-sm">
              <Cat className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg sm:text-xl text-slate-900 tracking-tight leading-none">
                  {settings.catName}&apos;s {settings.medicationName}
                </h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                  <Droplets className="w-3 h-3" />
                  {settings.dosageLabel}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                <span>
                  {now.toLocaleDateString([], {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric'
                  })}
                </span>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => setShowDeviceInfoModal(true)}
                  className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium underline decoration-emerald-300 underline-offset-2"
                >
                  <Wifi className="w-3 h-3" />
                  {isConnected ? 'Live Household Sync' : 'Connecting...'}
                </button>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleDarkMode}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs sm:text-sm transition active:scale-95 cursor-pointer"
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-600" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setSettingsForm(settings);
                setSettingsModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs sm:text-sm transition active:scale-95 cursor-pointer"
              title="Edit Household & Medication Settings"
            >
              <Settings className="w-4 h-4 text-slate-600" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-5">
        {/* ========================================== */}
        {/* SYNC ERROR NOTICE IF ANY                   */}
        {/* ========================================== */}
        {syncError && (
          <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{syncError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSyncError(null)}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-rose-100 hover:bg-rose-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ========================================== */}
        {/* 1) CURRENT STATUS ANTI-DOUBLE-DOSE BANNER  */}
        {/* ========================================== */}
        <section
          aria-label="Current Dose Status"
          className={`rounded-3xl p-5 sm:p-6 border shadow-lg transition-colors duration-300 ${statusBanner.theme}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase w-fit ${statusBanner.badgeTheme}`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {statusBanner.warningText}
            </span>

            {lastDoseInfo && (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium w-fit ${statusBanner.badgeTheme}`}
              >
                <Clock className="w-3.5 h-3.5" />
                Last dose: {getHoursSince(lastDoseInfo.timestamp, now.getTime())} (
                {formatReadableDate(lastDoseInfo.dateKey, todayKey)} {lastDoseInfo.slotLabel})
              </span>
            )}
          </div>

          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-2xl bg-white/15 backdrop-blur-xs shrink-0 mt-0.5">
              {statusBanner.icon}
            </div>
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-snug">
                {statusBanner.title}
              </h2>
              <p className="text-sm sm:text-base opacity-90 leading-relaxed">
                {statusBanner.subtitle}
              </p>
            </div>
          </div>
        </section>

        {/* ========================================== */}
        {/* HOUSEHOLD CAREGIVER QUICK SELECTOR         */}
        {/* ========================================== */}
        <section className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-teal-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Who is giving the dose right now?
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowAddCaregiver(!showAddCaregiver)}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              {showAddCaregiver ? 'Cancel' : 'Add Person'}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {(settings.caregivers || DEFAULT_SETTINGS.caregivers).map((person) => {
              const isSelected = selectedCaregiver === person;
              return (
                <button
                  key={person}
                  type="button"
                  onClick={() => setSelectedCaregiver(person)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-1.5 active:scale-95 ${
                    isSelected
                      ? 'bg-slate-900 text-white shadow-xs ring-2 ring-slate-900/10'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isSelected ? 'bg-emerald-400' : 'bg-slate-400'
                    }`}
                  />
                  {person}
                </button>
              );
            })}
          </div>

          {showAddCaregiver && (
            <form onSubmit={handleAddCaregiver} className="mt-3 flex gap-2">
              <input
                type="text"
                value={customCaregiverInput}
                onChange={(e) => setCustomCaregiverInput(e.target.value)}
                placeholder="Enter household member or sitter name..."
                className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                maxLength={30}
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition"
              >
                Save &amp; Select
              </button>
            </form>
          )}
        </section>

        {/* ========================================== */}
        {/* 2) LARGE TAP-FRIENDLY MORNING & EVENING    */}
        {/*    DOSE CHECKBOX CARDS                     */}
        {/* ========================================== */}
        <section
          aria-label="Today's Doses"
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {/* ---------------- MORNING DOSE CARD ---------------- */}
          <div
            className={`rounded-3xl p-5 border-2 transition-all flex flex-col justify-between ${
              morningDose?.given
                ? 'bg-emerald-50/70 border-emerald-400 shadow-sm'
                : 'bg-white border-slate-200 shadow-sm hover:border-amber-300'
            }`}
          >
            <div>
              {/* Card Header */}
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs ${
                      morningDose?.given
                        ? 'bg-emerald-600 text-white'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {morningDose?.given ? (
                      <Check className="w-7 h-7 stroke-[2.5]" />
                    ) : (
                      <Sun className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-extrabold text-slate-900">
                        Morning Dose
                      </h3>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                        ~{settings.morningTargetTime}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-500">
                      Dosage: <strong className="text-slate-700">{settings.dosageLabel}</strong>
                    </p>
                  </div>
                </div>

                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                    morningDose?.given
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {morningDose?.given ? 'Completed' : 'Pending'}
                </span>
              </div>

              {/* Card Body: Either Completed Details or Optional Note Input */}
              {morningDose?.given ? (
                <div className="bg-white/90 rounded-2xl p-4 border border-emerald-200 space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-medium">Time Given:</span>
                    <span className="font-bold text-emerald-800 text-base">
                      {formatTimeDisplay(morningDose.timestamp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-medium">Given By:</span>
                    <span className="font-bold text-slate-800 inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      {morningDose.givenBy}
                    </span>
                  </div>
                  {morningDose.note && (
                    <div className="pt-1.5 border-t border-slate-100 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Note: </span>
                      {morningDose.note}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Optional note (e.g., given with lick treat, syringe direct):
                  </label>
                  <input
                    type="text"
                    value={morningNoteInput}
                    onChange={(e) => setMorningNoteInput(e.target.value)}
                    placeholder="Add quick note (optional)..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                    maxLength={80}
                  />
                </div>
              )}
            </div>

            {/* Card Action Button */}
            {morningDose?.given ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openManualEntryModal(todayKey, 'morning', morningDose)}
                  className="flex-1 py-3 px-3 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-1.5"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit Time / Person
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmUndoModal({
                      dateKey: todayKey,
                      slot: 'morning',
                      existingData: morningDose
                    })
                  }
                  className="py-3 px-3.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-1"
                  title="Undo Morning Dose"
                >
                  <Trash2 className="w-4 h-4" />
                  Undo
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => handleRecordDose('morning', morningNoteInput)}
                  className="w-full py-4 px-5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-extrabold text-base sm:text-lg shadow-md shadow-amber-500/20 active:scale-[0.98] transition flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-6 h-6 shrink-0" />
                  <span>Check Morning Dose ({selectedCaregiver})</span>
                </button>
                <button
                  type="button"
                  onClick={() => openManualEntryModal(todayKey, 'morning', null)}
                  className="w-full py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 text-center"
                >
                  Gave it earlier? Log custom morning time
                </button>
              </div>
            )}
          </div>

          {/* ---------------- EVENING DOSE CARD ---------------- */}
          <div
            className={`rounded-3xl p-5 border-2 transition-all flex flex-col justify-between ${
              eveningDose?.given
                ? 'bg-emerald-50/70 border-emerald-400 shadow-sm'
                : 'bg-white border-slate-200 shadow-sm hover:border-indigo-300'
            }`}
          >
            <div>
              {/* Card Header */}
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs ${
                      eveningDose?.given
                        ? 'bg-emerald-600 text-white'
                        : 'bg-indigo-100 text-indigo-700'
                    }`}
                  >
                    {eveningDose?.given ? (
                      <Check className="w-7 h-7 stroke-[2.5]" />
                    ) : (
                      <Moon className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-extrabold text-slate-900">
                        Evening Dose
                      </h3>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                        ~{settings.eveningTargetTime}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-500">
                      Dosage: <strong className="text-slate-700">{settings.dosageLabel}</strong>
                    </p>
                  </div>
                </div>

                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                    eveningDose?.given
                      ? 'bg-emerald-600 text-white'
                      : 'bg-indigo-100 text-indigo-800'
                  }`}
                >
                  {eveningDose?.given ? 'Completed' : 'Pending'}
                </span>
              </div>

              {/* Card Body: Either Completed Details or Optional Note Input */}
              {eveningDose?.given ? (
                <div className="bg-white/90 rounded-2xl p-4 border border-emerald-200 space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-medium">Time Given:</span>
                    <span className="font-bold text-emerald-800 text-base">
                      {formatTimeDisplay(eveningDose.timestamp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-medium">Given By:</span>
                    <span className="font-bold text-slate-800 inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      {eveningDose.givenBy}
                    </span>
                  </div>
                  {eveningDose.note && (
                    <div className="pt-1.5 border-t border-slate-100 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Note: </span>
                      {eveningDose.note}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Optional note (e.g., given after dinner, appetite good):
                  </label>
                  <input
                    type="text"
                    value={eveningNoteInput}
                    onChange={(e) => setEveningNoteInput(e.target.value)}
                    placeholder="Add quick note (optional)..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    maxLength={80}
                  />
                </div>
              )}
            </div>

            {/* Card Action Button */}
            {eveningDose?.given ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openManualEntryModal(todayKey, 'evening', eveningDose)}
                  className="flex-1 py-3 px-3 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-1.5"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit Time / Person
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmUndoModal({
                      dateKey: todayKey,
                      slot: 'evening',
                      existingData: eveningDose
                    })
                  }
                  className="py-3 px-3.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-1"
                  title="Undo Evening Dose"
                >
                  <Trash2 className="w-4 h-4" />
                  Undo
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => handleRecordDose('evening', eveningNoteInput)}
                  className="w-full py-4 px-5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-extrabold text-base sm:text-lg shadow-md shadow-indigo-500/20 active:scale-[0.98] transition flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-6 h-6 shrink-0" />
                  <span>Check Evening Dose ({selectedCaregiver})</span>
                </button>
                <button
                  type="button"
                  onClick={() => openManualEntryModal(todayKey, 'evening', null)}
                  className="w-full py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 text-center"
                >
                  Gave it earlier? Log custom evening time
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ========================================== */}
        {/* 3) MEDICATION BOTTLE OPEN DATE & DOSAGE    */}
        {/*    TRACKER CARD                            */}
        {/* ========================================== */}
        <section
          aria-label="Bottle Shelf-Life & Dosage Tracker"
          className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                  bottleStatus.isExpired
                    ? 'bg-rose-100 text-rose-700'
                    : bottleStatus.isExpiringSoon
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-teal-50 text-teal-700'
                }`}
              >
                <Droplets className="w-6 h-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-base">
                    {settings.medicationName} Tracker
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-900 text-white">
                    {settings.dosageLabel} • 2x Daily
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Opened <strong className="text-slate-700">{bottleStatus.openedDateFormatted}</strong> ({bottleStatus.diffDaysOpen} days ago) • Discard after{' '}
                  <strong className="text-slate-700">{bottleStatus.expiryDateFormatted}</strong>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center">
              <button
                type="button"
                onClick={handleOpenNewBottleToday}
                className="px-3 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold transition flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Opened New Bottle Today
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsForm(settings);
                  setSettingsModalOpen(true);
                }}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Shelf-life progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-600">
                Bottle Shelf Life ({settings.bottleShelfLifeDays}-day limit once opened)
              </span>
              <span
                className={
                  bottleStatus.isExpired
                    ? 'text-rose-600 font-bold'
                    : bottleStatus.isExpiringSoon
                    ? 'text-amber-600 font-bold'
                    : 'text-teal-700'
                }
              >
                {bottleStatus.isExpired
                  ? `Expired ${Math.abs(bottleStatus.daysRemaining)} days ago — Replace bottle`
                  : `${bottleStatus.daysRemaining} days remaining`}
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  bottleStatus.isExpired
                    ? 'bg-rose-500'
                    : bottleStatus.isExpiringSoon
                    ? 'bg-amber-500'
                    : 'bg-teal-500'
                }`}
                style={{ width: `${bottleStatus.percentUsed}%` }}
              />
            </div>
          </div>

          {settings.administrationNote && (
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-start gap-2.5 text-xs text-slate-600">
              <Info className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800">Household Care Note: </span>
                {settings.administrationNote}
              </div>
            </div>
          )}
        </section>

        {/* ========================================== */}
        {/* 4) WEEKLY MEDICATION HISTORY LOG           */}
        {/* ========================================== */}
        <section
          aria-label="Medication History"
          className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Medication History
                </h3>
                <p className="text-xs text-slate-500">
                  Browse by week (Mon–Sun) or jump to any date to view or edit entries
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold w-fit">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>
                Week Adherence: {adherenceStats.pct}% ({adherenceStats.completed}/
                {adherenceStats.totalExpected} doses)
              </span>
            </div>
          </div>

          {/* Week Selector & Date Jump Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 mb-4 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelectedWeekMonday(shiftDateKeyByDays(activeWeekMonday, -7))
                }
                className="p-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition active:scale-95 cursor-pointer"
                title="Previous Week"
                aria-label="Previous Week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2 px-2">
                <Calendar className="w-4 h-4 text-teal-600 shrink-0" />
                <span className="text-xs sm:text-sm font-bold text-slate-900">
                  {weekRangeLabel}
                </span>
                {isCurrentWeek && (
                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                    This Week
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={isCurrentWeek}
                onClick={() => {
                  const nextMonday = shiftDateKeyByDays(activeWeekMonday, 7);
                  setSelectedWeekMonday(
                    nextMonday > currentWeekMonday ? currentWeekMonday : nextMonday
                  );
                }}
                className={`p-2 rounded-xl border transition ${
                  isCurrentWeek
                    ? 'bg-slate-100 text-slate-300 border-slate-200/60 cursor-not-allowed'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 active:scale-95 cursor-pointer'
                }`}
                title="Next Week"
                aria-label="Next Week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {!isCurrentWeek && (
                <button
                  type="button"
                  onClick={() => setSelectedWeekMonday(currentWeekMonday)}
                  className="px-2.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold transition cursor-pointer"
                >
                  This Week
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <label
                htmlFor="history-week-jump"
                className="text-xs font-semibold text-slate-500 whitespace-nowrap"
              >
                Jump to date:
              </label>
              <input
                id="history-week-jump"
                type="date"
                max={todayKey}
                value={isCurrentWeek ? todayKey : activeWeekMonday}
                onChange={(e) => {
                  if (e.target.value) {
                    const targetMon = getMondayOfWeek(e.target.value);
                    setSelectedWeekMonday(
                      targetMon > currentWeekMonday ? currentWeekMonday : targetMon
                    );
                  }
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {isLoadingData ? (
            <div className="py-10 text-center text-sm text-slate-400">
              Loading {settings.catName}&apos;s medication history...
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedWeekDays.map((dateKey) => {
                const dayRecord = logsByDate[dateKey] || {};
                const am = dayRecord.morning;
                const pm = dayRecord.evening;
                const isToday = dateKey === todayKey;

                return (
                  <div
                    key={dateKey}
                    className={`py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                      isToday ? 'bg-teal-50/30 -mx-3 px-3 rounded-2xl' : ''
                    }`}
                  >
                    {/* Date Label */}
                    <div className="flex items-center gap-2.5 min-w-[140px]">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          am?.given && pm?.given
                            ? 'bg-emerald-500'
                            : am?.given || pm?.given
                            ? 'bg-amber-400'
                            : 'bg-slate-300'
                        }`}
                      />
                      <div>
                        <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                          <span>{formatReadableDate(dateKey, todayKey)}</span>
                          {isToday && (
                            <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-medium">{dateKey}</div>
                      </div>
                    </div>

                    {/* AM and PM Status Pills */}
                    <div className="grid grid-cols-2 gap-2 flex-1 max-w-md">
                      {/* Morning Pill */}
                      <button
                        type="button"
                        onClick={() => openManualEntryModal(dateKey, 'morning', am)}
                        className={`px-3 py-2 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
                          am?.given
                            ? 'bg-emerald-50/80 border-emerald-200 hover:bg-emerald-100/70 text-emerald-950'
                            : 'bg-slate-50 border-slate-200/80 hover:bg-slate-100 text-slate-500'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-xs font-bold">
                            <Sun
                              className={`w-3.5 h-3.5 shrink-0 ${
                                am?.given ? 'text-amber-500' : 'text-slate-400'
                              }`}
                            />
                            <span>AM</span>
                            {am?.given && (
                              <span className="text-emerald-700 font-extrabold">
                                • {formatTimeDisplay(am.timestamp)}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] truncate mt-0.5">
                            {am?.given
                              ? `By ${am.givenBy}${am.note ? ` • ${am.note}` : ''}`
                              : 'Not logged (Tap to add)'}
                          </div>
                        </div>
                        {am?.given ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                      </button>

                      {/* Evening Pill */}
                      <button
                        type="button"
                        onClick={() => openManualEntryModal(dateKey, 'evening', pm)}
                        className={`px-3 py-2 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
                          pm?.given
                            ? 'bg-emerald-50/80 border-emerald-200 hover:bg-emerald-100/70 text-emerald-950'
                            : 'bg-slate-50 border-slate-200/80 hover:bg-slate-100 text-slate-500'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-xs font-bold">
                            <Moon
                              className={`w-3.5 h-3.5 shrink-0 ${
                                pm?.given ? 'text-indigo-500' : 'text-slate-400'
                              }`}
                            />
                            <span>PM</span>
                            {pm?.given && (
                              <span className="text-emerald-700 font-extrabold">
                                • {formatTimeDisplay(pm.timestamp)}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] truncate mt-0.5">
                            {pm?.given
                              ? `By ${pm.givenBy}${pm.note ? ` • ${pm.note}` : ''}`
                              : 'Not logged (Tap to add)'}
                          </div>
                        </div>
                        {pm?.given ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ========================================== */}
      {/* MODAL 1: UNDO CONFIRMATION MODAL           */}
      {/* ========================================== */}
      {confirmUndoModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-11 h-11 rounded-2xl bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Uncheck {confirmUndoModal.slot === 'morning' ? 'Morning' : 'Evening'} Dose?
                </h3>
                <p className="text-xs text-slate-500">
                  Date: {confirmUndoModal.dateKey}
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              This dose was marked as given at{' '}
              <strong>{formatTimeDisplay(confirmUndoModal.existingData?.timestamp)}</strong> by{' '}
              <strong>{confirmUndoModal.existingData?.givenBy}</strong>. Unchecking it will show
              the dose as pending on everyone&apos;s phone.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmUndoModal(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm"
              >
                Keep Checked
              </button>
              <button
                type="button"
                onClick={handleConfirmUndoDose}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm"
              >
                Yes, Uncheck Dose
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 2: MANUAL / PAST DOSE ENTRY MODAL    */}
      {/* ========================================== */}
      {manualLogModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {manualLogModal.existingData?.given ? 'Edit' : 'Log'}{' '}
                  {manualLogModal.slot === 'morning' ? 'Morning (AM)' : 'Evening (PM)'} Dose
                </h3>
                <p className="text-xs text-slate-500">
                  Date: {formatReadableDate(manualLogModal.dateKey, todayKey)} (
                  {manualLogModal.dateKey})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualLogModal(null)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveManualEntry} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Time Dose Was Given
                </label>
                <input
                  type="time"
                  value={manualTimeInput}
                  onChange={(e) => setManualTimeInput(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Given By
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(settings.caregivers || DEFAULT_SETTINGS.caregivers).map((person) => (
                    <button
                      key={person}
                      type="button"
                      onClick={() => setManualCaregiverInput(person)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                        manualCaregiverInput === person
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {person}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={manualCaregiverInput}
                  onChange={(e) => setManualCaregiverInput(e.target.value)}
                  placeholder="Name of person..."
                  required
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Optional Note
                </label>
                <input
                  type="text"
                  value={manualNoteInput}
                  onChange={(e) => setManualNoteInput(e.target.value)}
                  placeholder="e.g., Took well with wet food"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                {manualLogModal.existingData?.given ? (
                  <button
                    type="button"
                    onClick={() => {
                      const modalRef = manualLogModal;
                      setManualLogModal(null);
                      setConfirmUndoModal(modalRef);
                    }}
                    className="px-3.5 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs sm:text-sm"
                  >
                    Clear / Uncheck
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setManualLogModal(null)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm"
                  >
                    Save Entry
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 3: DOSAGE & BOTTLE SETTINGS MODAL    */}
      {/* ========================================== */}
      {settingsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Household &amp; Medication Settings
                </h3>
                <p className="text-xs text-slate-500">
                  Changes sync immediately across all household devices
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsModalOpen(false)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Pet Name
                  </label>
                  <input
                    type="text"
                    value={settingsForm.catName}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, catName: e.target.value })
                    }
                    placeholder="e.g., Mochi"
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Prescribed Dosage Badge
                  </label>
                  <input
                    type="text"
                    value={settingsForm.dosageLabel}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, dosageLabel: e.target.value })
                    }
                    placeholder="e.g., 2.5 mg / 0.5 ml"
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Medication Name
                </label>
                <input
                  type="text"
                  value={settingsForm.medicationName}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, medicationName: e.target.value })
                  }
                  placeholder="e.g., Oral Solution, Methimazole"
                  required
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Morning Target Time
                  </label>
                  <input
                    type="time"
                    value={settingsForm.morningTargetTime}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, morningTargetTime: e.target.value })
                    }
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Evening Target Time
                  </label>
                  <input
                    type="time"
                    value={settingsForm.eveningTargetTime}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, eveningTargetTime: e.target.value })
                    }
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Current Bottle Opened Date
                  </label>
                  <input
                    type="date"
                    value={settingsForm.bottleOpenedDate}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, bottleOpenedDate: e.target.value })
                    }
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Shelf Life Once Opened (Days)
                  </label>
                  <input
                    type="number"
                    min="7"
                    max="365"
                    value={settingsForm.bottleShelfLifeDays}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        bottleShelfLifeDays: Number(e.target.value) || 180
                      })
                    }
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Household Members / Caregivers (Comma Separated)
                </label>
                <input
                  type="text"
                  value={
                    settingsForm.caregiversText !== undefined
                      ? settingsForm.caregiversText
                      : (settingsForm.caregivers || []).join(', ')
                  }
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      caregiversText: e.target.value
                    })
                  }
                  placeholder="Partner 1, Partner 2, Pet Sitter"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Administration &amp; Care Instructions
                </label>
                <textarea
                  rows={2}
                  value={settingsForm.administrationNote}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, administrationNote: e.target.value })
                  }
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSettingsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm"
                >
                  Save Household Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 4: HOUSEHOLD SYNC & DEVICE ID INFO   */}
      {/* ========================================== */}
      {showDeviceInfoModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Local Household Server Sync</h3>
                  <p className="text-xs text-emerald-700 font-semibold">
                    {isConnected
                      ? 'Connected to Local SQLite Server (2.5s Live Polling)'
                      : 'Reconnecting to Local Server...'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeviceInfoModal(false)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              All medication history and bottle settings are stored privately on your home server
              in a local SQLite database. Connected phones and tablets automatically sync every
              2.5 seconds.
            </p>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
              <div className="text-slate-500 font-semibold">Local Device Identifier:</div>
              <div className="font-mono text-slate-800 break-all select-all bg-white p-2 rounded-lg border border-slate-200">
                {deviceId}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowDeviceInfoModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}