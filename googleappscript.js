/**
 * @OnlyCurrentDoc
 * Backend API untuk Aplikasi Kasir V4.
 * Penambahan:
 * - Menyimpan item kustom secara otomatis saat transaksi.
 * - Endpoint baru untuk filter laporan berdasarkan rentang tanggal.
 */

const SHEETS = {
  TRANSACTIONS: 'Transaksi',
  INVENTORY: 'Inventaris Produk',
  SERVICES: 'Daftar Layanan',
  CUSTOMERS: 'Data Pelanggan',
  CASH_NOTES: 'Catatan Kas'
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); 

  try {
    setupSpreadsheet();
    
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload;
    let responseData;

    switch (action) {
      case 'getInitialData':
        responseData = getInitialData();
        break;
      case 'recordTransaction':
        responseData = recordTransaction(payload);
        break;
      case 'getSheetData':
        responseData = getSheetData(payload.sheetName);
        break;
      case 'saveItem':
        responseData = saveItem(payload.itemData, payload.type);
        break;
      case 'deleteItem':
        responseData = deleteItem(payload.id, payload.type);
        break;
      case 'recordCashNote':
        responseData = recordCashNote(payload);
        break;
      case 'getFilteredData': // Endpoint baru
        responseData = getFilteredData(payload);
        break;
      default:
        throw new Error('Action tidak valid: ' + action);
    }
    
    const response = { status: 'success', data: responseData };
    return ContentService.createTextOutput(JSON.stringify(response))
                         .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString() + '\n' + error.stack);
    const response = { status: 'error', error: error.message };
    return ContentService.createTextOutput(JSON.stringify(response))
                         .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = ss.getSheets().map(s => s.getName());
  
  const createSheetWithHeaders = (sheetName, headers) => {
    if (!allSheets.includes(sheetName)) {
      const sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground("#f3f4f6");
      sheet.setFrozenRows(1);
    }
  };

  createSheetWithHeaders(SHEETS.TRANSACTIONS, ['ID Transaksi', 'Waktu', 'Nama Pelanggan', 'RME', 'Items (JSON)', 'Subtotal', 'Diskon', 'Total', 'Metode Pembayaran', 'Kasir']);
  createSheetWithHeaders(SHEETS.INVENTORY, ['ID Produk', 'Nama Produk', 'Kategori', 'Stok', 'Harga Jual', 'Harga Beli', 'Notifikasi Stok Rendah']);
  createSheetWithHeaders(SHEETS.SERVICES, ['ID Layanan', 'Nama Layanan', 'Kategori', 'Harga']);
  createSheetWithHeaders(SHEETS.CUSTOMERS, ['Nama Pelanggan', 'Kontak/RME', 'Total Kunjungan', 'Total Belanja', 'Riwayat Transaksi (JSON)', 'Pertama Datang', 'Terakhir Datang']);
  createSheetWithHeaders(SHEETS.CASH_NOTES, ['ID Catatan', 'Waktu', 'Tipe', 'Deskripsi', 'Nominal']);
}

function getInitialData() {
  const products = getSheetData(SHEETS.INVENTORY).map(row => ({ id: row[0], name: row[1], category: row[2], stock: row[3], price: row[4], buy_price: row[5], low_stock: row[6], type: 'product' }));
  const services = getSheetData(SHEETS.SERVICES).map(row => ({ id: row[0], name: row[1], category: row[2], price: row[3], type: 'service' }));
  const transactions = getSheetData(SHEETS.TRANSACTIONS);
  const customers = getSheetData(SHEETS.CUSTOMERS);
  const cashNotes = getSheetData(SHEETS.CASH_NOTES);
  const spreadsheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  
  return { products, services, transactions, customers, cashNotes, spreadsheetUrl };
}

function getFilteredData(payload) {
    const { startDate, endDate } = payload;
    if (!startDate || !endDate) {
      throw new Error("Rentang tanggal harus disediakan.");
    }
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const filterByDate = (data, dateIndex) => {
        return data.filter(row => {
            const rowDate = new Date(row[dateIndex]);
            return rowDate >= start && rowDate <= end;
        });
    };

    const transactions = filterByDate(getSheetData(SHEETS.TRANSACTIONS), 1);
    const cashNotes = filterByDate(getSheetData(SHEETS.CASH_NOTES), 1);

    return { transactions, cashNotes };
}


function recordTransaction(transactionData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const transSheet = ss.getSheetByName(SHEETS.TRANSACTIONS);
  const inventorySheet = ss.getSheetByName(SHEETS.INVENTORY);
  const custSheet = ss.getSheetByName(SHEETS.CUSTOMERS);

  const transactionId = `INV-${new Date().getTime()}`;
  
  // Proses item kustom sebelum menyimpan transaksi
  transactionData.items.forEach(item => {
      if (item.type === 'custom' && item.id.startsWith('custom-')) {
          const newId = `P${new Date().getTime()}${Math.floor(Math.random() * 100)}`;
          // Simpan sebagai produk baru dengan stok unlimited (-1)
          inventorySheet.appendRow([
              newId,
              item.name,
              item.category || 'Kustom',
              -1, // Stok unlimited
              item.price,
              0,  // Harga Beli default
              0   // Notifikasi Stok Rendah default
          ]);
          item.id = newId; // Ganti ID sementara dengan ID permanen
          item.type = 'product'; // Ubah tipe menjadi produk
      }
  });

  const itemsJSON = JSON.stringify(transactionData.items);
  
  transSheet.appendRow([
    transactionId, 
    new Date(transactionData.datetime), 
    transactionData.customerName, 
    transactionData.rme, 
    itemsJSON, 
    transactionData.subtotal, 
    transactionData.discount, 
    transactionData.total, 
    transactionData.paymentMethod, 
    'Kasir'
  ]);

  // Update stok (hanya untuk item produk)
  if (inventorySheet && inventorySheet.getLastRow() > 1) {
    const productDataRange = inventorySheet.getRange(2, 1, inventorySheet.getLastRow() - 1, inventorySheet.getLastColumn());
    const productData = productDataRange.getValues();
    let needsUpdate = false;
    
    transactionData.items.forEach(item => {
      if (item.type === 'product') { 
        for (let i = 0; i < productData.length; i++) {
          if (productData[i][0] === item.id) {
            const currentStock = Number(productData[i][3]);
            if (!isNaN(currentStock) && currentStock !== -1) { // Pastikan stok adalah angka & bukan unlimited
                productData[i][3] = currentStock - item.quantity;
                needsUpdate = true;
            }
            break;
          }
        }
      }
    });

    if (needsUpdate) {
      productDataRange.setValues(productData);
    }
  }

  // Update data pelanggan
  if (transactionData.customerName.toLowerCase() !== 'anonim' && transactionData.customerName.trim() !== '') {
    updateCustomerData(custSheet, transactionData, transactionId);
  }

  return transactionId;
}

function updateCustomerData(custSheet, transactionData, transactionId) {
    if (!custSheet) return;
    const customerKey = transactionData.rme || transactionData.customerName;
    const customerData = custSheet.getLastRow() > 1 ? custSheet.getRange(2, 1, custSheet.getLastRow() - 1, custSheet.getLastColumn()).getValues() : [];
    let customerRowIndex = -1;
    for(let i = 0; i < customerData.length; i++) { if(customerData[i][1] === customerKey || customerData[i][0] === customerKey) { customerRowIndex = i + 2; break; } }
    const today = new Date();
    if (customerRowIndex !== -1) {
      const currentVisits = custSheet.getRange(customerRowIndex, 3).getValue();
      const currentSpending = custSheet.getRange(customerRowIndex, 4).getValue();
      let history = JSON.parse(custSheet.getRange(customerRowIndex, 5).getValue() || '[]');
      history.push(transactionId);
      custSheet.getRange(customerRowIndex, 3).setValue(currentVisits + 1);
      custSheet.getRange(customerRowIndex, 4).setValue(currentSpending + transactionData.total);
      custSheet.getRange(customerRowIndex, 5).setValue(JSON.stringify(history));
      custSheet.getRange(customerRowIndex, 7).setValue(today);
    } else {
      custSheet.appendRow([transactionData.customerName, customerKey, 1, transactionData.total, JSON.stringify([transactionId]), today, today]);
    }
}

function recordCashNote(noteData) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CASH_NOTES);
  if (!sheet) throw new Error(`Sheet "${SHEETS.CASH_NOTES}" tidak ditemukan.`);
  const noteId = `NOTE-${new Date().getTime()}`;
  sheet.appendRow([ noteId, new Date(noteData.datetime), noteData.type, noteData.description, noteData.amount ]);
  return `Catatan ${noteData.type} berhasil disimpan.`;
}

function getSheetData(sheetName) {
  if (!Object.values(SHEETS).includes(sheetName)) throw new Error("Nama sheet tidak valid.");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) { return []; }
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
}

function saveItem(itemData, type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = type === 'product' ? SHEETS.INVENTORY : SHEETS.SERVICES;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" tidak ditemukan.`);
  
  const data = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat() : [];
  const rowIndex = data.indexOf(itemData.id) + 2;

  if (rowIndex > 1) { // Update
    if (type === 'product') {
      sheet.getRange(rowIndex, 2, 1, 6).setValues([[itemData.name, itemData.category, itemData.stock, itemData.price, itemData.buy_price, itemData.low_stock]]);
    } else {
      sheet.getRange(rowIndex, 2, 1, 3).setValues([[itemData.name, itemData.category, itemData.price]]);
    }
  } else { // Tambah baru
    const newId = type === 'product' ? `P${new Date().getTime()}` : `L${new Date().getTime()}`;
    const newRow = type === 'product'
      ? [newId, itemData.name, itemData.category, itemData.stock, itemData.price, itemData.buy_price, itemData.low_stock]
      : [newId, itemData.name, itemData.category, itemData.price];
    sheet.appendRow(newRow);
  }
  return 'Data berhasil disimpan.';
}

function deleteItem(id, type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = type === 'product' ? SHEETS.INVENTORY : SHEETS.SERVICES;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" tidak ditemukan.`);
  
  const data = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat() : [];
  const rowIndex = data.indexOf(id) + 2;
  
  if (rowIndex > 1) {
    sheet.deleteRow(rowIndex);
    return 'Item berhasil dihapus.';
  }
  throw new Error('Item tidak ditemukan untuk dihapus.');
}
 
