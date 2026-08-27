import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      appName: 'Library Manager',
      nav: {
        dashboard: 'Dashboard', floors: 'Seat Map', students: 'Students', addStudent: 'Add Student',
        pastStudents: 'Past Students', billing: 'Billing', payments: 'Payments', receipts: 'Receipts',
        expenses: 'Expenses', attendance: 'Attendance', notices: 'Notices', reports: 'Reports', settings: 'Settings',
        admins: 'Admins & Roles',
        home: 'Home', mySeat: 'My Seat', fees: 'Fees', profile: 'Profile', logout: 'Log out',
        library: 'Library Info',
      },
      login: {
        adminTitle: 'Admin / Staff Login', studentTitle: 'Student Login', email: 'Email', password: 'Password',
        studentId: 'Student ID', submit: 'Log in', switchToStudent: 'Student login instead',
        switchToAdmin: 'Admin / staff login instead', invalid: 'Invalid credentials.',
      },
      dashboard: {
        today: 'Today', activeStudents: 'Active students', present: 'Present today', totalSeats: 'Total seats',
        availableSeats: 'Available seats', todaysPayments: "Today's payments", todaysExpenses: "Today's expenses",
        paymentDue: 'Payment due',
      },
      seats: {
        selectFloor: 'Select floor', available: 'Available', occupied: 'Occupied', disabled: 'Disabled',
        conflict: 'Overlap', allocate: 'Allocate student', endAllocation: 'End allocation', viewStudent: 'View student',
      },
      students: {
        addStudent: 'Add Student', search: 'Search by name, ID, or mobile', status: 'Status', active: 'Active',
        past: 'Past', save: 'Save', created: 'Student created successfully', tempPassword: 'Temporary password',
      },
      common: {
        loading: 'Loading…', noResults: 'No results found.', error: 'Unable to load this. Please retry.',
        retry: 'Retry', cancel: 'Cancel', confirm: 'Confirm', save: 'Save', close: 'Close', edit: 'Edit',
        add: 'Add', remove: 'Remove', delete: 'Delete', reason: 'Reason', notes: 'Notes', status: 'Status',
        date: 'Date', amount: 'Amount', download: 'Download', view: 'View', print: 'Print',
      },
      attendance: {
        title: 'Attendance', present: 'Present', absent: 'Absent', notMarked: 'Not marked',
        percentage: 'Attendance %', search: 'Search students…',
      },
      billing: {
        title: 'Billing & Payments', newBilling: 'New billing record', recordPayment: 'Record payment',
        billingMonth: 'Billing month', baseFee: 'Base fee (₹)', discount: 'Discount (₹)', lateFee: 'Late fee (₹)',
        dueDate: 'Due date', payable: 'Payable', paid: 'Paid', method: 'Method', cash: 'Cash', upi: 'UPI',
        pending: 'Pending', overdue: 'Overdue', partiallyPaid: 'Partially paid', waived: 'Waived',
      },
      notices: {
        title: 'Notices', addNotice: 'Add notice', titleEn: 'Title (English)', titleHi: 'Title (Hindi)',
        descriptionEn: 'Description (English)', descriptionHi: 'Description (Hindi)', priority: 'Priority',
        publishDate: 'Publish date', expiryDate: 'Expiry date', normal: 'Normal', high: 'High', important: 'Important',
      },
      settingsPage: {
        title: 'Settings', librarySettings: 'Library settings', libraryName: 'Library name', address: 'Address',
        phone: 'Phone', email: 'Email', openingTime: 'Opening time', closingTime: 'Closing time',
        lateFeeConfig: 'Default late fee', holidays: 'Holidays', weeklyHolidays: 'Weekly holidays',
        specialHolidays: 'Special holidays', floors: 'Floors', addFloor: 'Add floor', saveSettings: 'Save settings',
      },
      adminsPage: {
        title: 'Admins & Roles', addAdmin: 'Add admin', roles: 'Roles', addRole: 'Add role',
        superAdmin: 'Super admin', staff: 'Staff', editPermissions: 'Edit permissions',
      },
      studentPortal: {
        welcome: 'Welcome', currentSeat: 'Current seat', noAllocation: 'No active seat allocation.',
        mySeat: 'My Seat', allocationHistory: 'Allocation history', vacationHistory: 'Vacation history',
        fees: 'Fees', receipts: 'Receipts', libraryInfo: 'Library Information', upcomingHolidays: 'Upcoming holidays',
        contactStaff: 'To update your details or reset your password, please contact library staff.',
      },
      reportsPage: {
        title: 'Reports', financial: 'Financial', students: 'Students', seats: 'Seats', payments: 'Payments',
        attendance: 'Attendance', expenses: 'Expenses', exportCsv: 'Export CSV', exportExcel: 'Export Excel',
      },
    },
  },
  hi: {
    translation: {
      appName: 'लाइब्रेरी मैनेजर',
      nav: {
        dashboard: 'डैशबोर्ड', floors: 'सीट मैप', students: 'छात्र', addStudent: 'छात्र जोड़ें',
        pastStudents: 'पूर्व छात्र', billing: 'बिलिंग', payments: 'भुगतान', receipts: 'रसीदें',
        expenses: 'खर्च', attendance: 'उपस्थिति', notices: 'सूचनाएं', reports: 'रिपोर्ट', settings: 'सेटिंग्स',
        admins: 'एडमिन और भूमिकाएं',
        home: 'होम', mySeat: 'मेरी सीट', fees: 'शुल्क', profile: 'प्रोफ़ाइल', logout: 'लॉग आउट',
        library: 'लाइब्रेरी जानकारी',
      },
      login: {
        adminTitle: 'एडमिन / स्टाफ लॉगिन', studentTitle: 'छात्र लॉगिन', email: 'ईमेल', password: 'पासवर्ड',
        studentId: 'छात्र आईडी', submit: 'लॉग इन करें', switchToStudent: 'छात्र लॉगिन पर जाएं',
        switchToAdmin: 'एडमिन/स्टाफ लॉगिन पर जाएं', invalid: 'गलत जानकारी।',
      },
      dashboard: {
        today: 'आज', activeStudents: 'सक्रिय छात्र', present: 'आज उपस्थित', totalSeats: 'कुल सीटें',
        availableSeats: 'उपलब्ध सीटें', todaysPayments: 'आज का भुगतान', todaysExpenses: 'आज का खर्च',
        paymentDue: 'बकाया भुगतान',
      },
      seats: {
        selectFloor: 'फ्लोर चुनें', available: 'उपलब्ध', occupied: 'भरा हुआ', disabled: 'निष्क्रिय',
        conflict: 'ओवरलैप', allocate: 'छात्र आवंटित करें', endAllocation: 'आवंटन समाप्त करें', viewStudent: 'छात्र देखें',
      },
      students: {
        addStudent: 'छात्र जोड़ें', search: 'नाम, आईडी या मोबाइल से खोजें', status: 'स्थिति', active: 'सक्रिय',
        past: 'पूर्व', save: 'सहेजें', created: 'छात्र सफलतापूर्वक बनाया गया', tempPassword: 'अस्थायी पासवर्ड',
      },
      common: {
        loading: 'लोड हो रहा है…', noResults: 'कोई परिणाम नहीं मिला।', error: 'लोड नहीं हो सका। पुनः प्रयास करें।',
        retry: 'पुनः प्रयास करें', cancel: 'रद्द करें', confirm: 'पुष्टि करें', save: 'सहेजें', close: 'बंद करें',
        edit: 'संपादित करें', add: 'जोड़ें', remove: 'हटाएं', delete: 'मिटाएं', reason: 'कारण', notes: 'टिप्पणी',
        status: 'स्थिति', date: 'तारीख', amount: 'राशि', download: 'डाउनलोड करें', view: 'देखें', print: 'प्रिंट करें',
      },
      attendance: {
        title: 'उपस्थिति', present: 'उपस्थित', absent: 'अनुपस्थित', notMarked: 'अंकित नहीं',
        percentage: 'उपस्थिति %', search: 'छात्र खोजें…',
      },
      billing: {
        title: 'बिलिंग और भुगतान', newBilling: 'नया बिलिंग रिकॉर्ड', recordPayment: 'भुगतान दर्ज करें',
        billingMonth: 'बिलिंग माह', baseFee: 'मूल शुल्क (₹)', discount: 'छूट (₹)', lateFee: 'विलंब शुल्क (₹)',
        dueDate: 'देय तिथि', payable: 'देय राशि', paid: 'भुगतान किया गया', method: 'तरीका', cash: 'नकद', upi: 'यूपीआई',
        pending: 'लंबित', overdue: 'अतिदेय', partiallyPaid: 'आंशिक भुगतान', waived: 'माफ किया गया',
      },
      notices: {
        title: 'सूचनाएं', addNotice: 'सूचना जोड़ें', titleEn: 'शीर्षक (अंग्रेज़ी)', titleHi: 'शीर्षक (हिंदी)',
        descriptionEn: 'विवरण (अंग्रेज़ी)', descriptionHi: 'विवरण (हिंदी)', priority: 'प्राथमिकता',
        publishDate: 'प्रकाशन तिथि', expiryDate: 'समाप्ति तिथि', normal: 'सामान्य', high: 'उच्च', important: 'महत्वपूर्ण',
      },
      settingsPage: {
        title: 'सेटिंग्स', librarySettings: 'लाइब्रेरी सेटिंग्स', libraryName: 'लाइब्रेरी का नाम', address: 'पता',
        phone: 'फोन', email: 'ईमेल', openingTime: 'खुलने का समय', closingTime: 'बंद होने का समय',
        lateFeeConfig: 'डिफ़ॉल्ट विलंब शुल्क', holidays: 'छुट्टियां', weeklyHolidays: 'साप्ताहिक छुट्टियां',
        specialHolidays: 'विशेष छुट्टियां', floors: 'फ्लोर', addFloor: 'फ्लोर जोड़ें', saveSettings: 'सेटिंग्स सहेजें',
      },
      adminsPage: {
        title: 'एडमिन और भूमिकाएं', addAdmin: 'एडमिन जोड़ें', roles: 'भूमिकाएं', addRole: 'भूमिका जोड़ें',
        superAdmin: 'सुपर एडमिन', staff: 'स्टाफ', editPermissions: 'अनुमतियां संपादित करें',
      },
      studentPortal: {
        welcome: 'स्वागत है', currentSeat: 'वर्तमान सीट', noAllocation: 'कोई सक्रिय सीट आवंटन नहीं।',
        mySeat: 'मेरी सीट', allocationHistory: 'आवंटन इतिहास', vacationHistory: 'अवकाश इतिहास',
        fees: 'शुल्क', receipts: 'रसीदें', libraryInfo: 'लाइब्रेरी जानकारी', upcomingHolidays: 'आगामी छुट्टियां',
        contactStaff: 'अपनी जानकारी अपडेट करने या पासवर्ड रीसेट करने के लिए, कृपया लाइब्रेरी स्टाफ से संपर्क करें।',
      },
      reportsPage: {
        title: 'रिपोर्ट', financial: 'वित्तीय', students: 'छात्र', seats: 'सीटें', payments: 'भुगतान',
        attendance: 'उपस्थिति', expenses: 'खर्च', exportCsv: 'CSV निर्यात करें', exportExcel: 'Excel निर्यात करें',
      },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('lib_lang') || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
