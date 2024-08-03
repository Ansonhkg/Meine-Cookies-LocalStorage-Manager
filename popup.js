document.getElementById("exportBtn").addEventListener("click", exportData);
document
  .getElementById("importBtn")
  .addEventListener("click", () =>
    document.getElementById("fileInput").click()
  );
document.getElementById("fileInput").addEventListener("change", importData);
document
  .getElementById("exportType")
  .addEventListener("change", toggleExportPassword);
document
  .getElementById("importType")
  .addEventListener("change", toggleImportPassword);

function toggleExportPassword() {
  const passwordField = document.getElementById("exportPassword");
  passwordField.classList.toggle(
    "hidden",
    document.getElementById("exportType").value === "raw"
  );
}

function toggleImportPassword() {
  const passwordField = document.getElementById("importPassword");
  passwordField.classList.toggle(
    "hidden",
    document.getElementById("importType").value === "raw"
  );
}

function showStatus(message) {
  document.getElementById("status").textContent = message;
  setTimeout(() => (document.getElementById("status").textContent = ""), 3000);
}

function showError(message) {
  document.getElementById("error").textContent = message;
  setTimeout(() => (document.getElementById("error").textContent = ""), 5000);
}

function encryptData(data, password) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), password).toString();
}

function decryptData(encryptedData, password) {
  const bytes = CryptoJS.AES.decrypt(encryptedData, password);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

function exportData() {
  const exportType = document.getElementById("exportType").value;
  const password = document.getElementById("exportPassword").value;

  if (exportType === "encrypted" && !password) {
    showError("Please enter a password for encryption");
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (chrome.runtime.lastError) {
      showError("Error querying tabs: " + chrome.runtime.lastError.message);
      return;
    }

    const url = new URL(tabs[0].url);
    const domain = url.hostname;
    const schemes = ["http", "https"];
    const paths = ["/"];

    let cookiePromises = [];
    schemes.forEach((scheme) => {
      paths.forEach((path) => {
        cookiePromises.push(
          new Promise((resolve) => {
            chrome.cookies.getAll(
              { url: `${scheme}://${domain}${path}` },
              (cookies) => {
                resolve(cookies);
              }
            );
          })
        );
      });
    });

    Promise.all(cookiePromises)
      .then((cookieArrays) => {
        const cookies = cookieArrays.flat();

        console.log("Exporting cookies:", cookies);

        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            func: () => ({
              localStorage: JSON.stringify(localStorage),
              sessionStorage: JSON.stringify(sessionStorage),
            }),
          },
          (results) => {
            let localStorage = {};
            let sessionStorage = {};
            if (chrome.runtime.lastError) {
              console.warn(
                "Error getting localStorage or sessionStorage: " +
                  chrome.runtime.lastError.message
              );
            } else {
              try {
                localStorage = JSON.parse(results[0].result.localStorage);
                sessionStorage = JSON.parse(results[0].result.sessionStorage);
              } catch (error) {
                console.error("Error parsing storage data:", error);
              }
            }

            const data = {
              cookies: cookies,
              localStorage: localStorage,
              sessionStorage: sessionStorage,
            };

            console.log("Exporting data:", data);

            let exportData, fileType, fileName;
            if (exportType === "encrypted") {
              exportData = encryptData(data, password);
              fileType = "application/octet-stream";
              fileName = `${domain}_encrypted_data.bin`;
            } else {
              exportData = JSON.stringify(data, null, 2);
              fileType = "application/json";
              fileName = `${domain}_data.json`;
            }

            const blob = new Blob([exportData], { type: fileType });
            const url = URL.createObjectURL(blob);
            chrome.downloads.download(
              {
                url: url,
                filename: fileName,
              },
              function (downloadId) {
                if (chrome.runtime.lastError) {
                  showError(
                    "Error initiating download: " +
                      chrome.runtime.lastError.message
                  );
                } else {
                  showStatus("Data exported successfully");
                }
              }
            );
          }
        );
      })
      .catch((error) => {
        showError("Error retrieving cookies: " + error.message);
      });
  });
}

function importData(event) {
  const importType = document.getElementById("importType").value;
  const password = document.getElementById("importPassword").value;

  if (importType === "encrypted" && !password) {
    showError("Please enter a password for decryption");
    return;
  }

  const file = event.target.files[0];
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      let data;
      if (importType === "encrypted") {
        const encryptedData = e.target.result;
        data = decryptData(encryptedData, password);
      } else {
        data = JSON.parse(e.target.result);
      }

      console.log("Importing data:", data);
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) {
          showError("Error querying tabs: " + chrome.runtime.lastError.message);
          return;
        }

        const url = new URL(tabs[0].url);
        const domain = url.hostname;

        // Import cookies
        data.cookies.forEach((cookie) => {
          let cookieUrl = `http${cookie.secure ? "s" : ""}://${cookie.domain}${
            cookie.path
          }`;
          // Handle cookies with domain starting with '.'
          if (cookie.domain.startsWith(".")) {
            cookieUrl = `http${cookie.secure ? "s" : ""}://${domain}${
              cookie.path
            }`;
          }

          chrome.cookies.set(
            {
              url: cookieUrl,
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              expirationDate: cookie.expirationDate,
              sameSite: cookie.sameSite,
            },
            function () {
              if (chrome.runtime.lastError) {
                console.error(
                  "Error setting cookie:",
                  chrome.runtime.lastError.message
                );
              } else {
                console.log(`Cookie set: ${cookie.name}`);
              }
            }
          );
        });

        // Import localStorage and sessionStorage
        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            func: (localStorageData, sessionStorageData) => {
              for (let key in localStorageData) {
                localStorage.setItem(key, localStorageData[key]);
                console.log(`LocalStorage set: ${key}`);
              }
              for (let key in sessionStorageData) {
                sessionStorage.setItem(key, sessionStorageData[key]);
                console.log(`SessionStorage set: ${key}`);
              }
            },
            args: [data.localStorage, data.sessionStorage],
          },
          () => {
            if (chrome.runtime.lastError) {
              showError(
                "Error setting storage: " + chrome.runtime.lastError.message
              );
            } else {
              showStatus("Data imported successfully");
            }
          }
        );
      });
    } catch (error) {
      showError("Error processing imported data: " + error.message);
    }
  };
  reader.readAsText(file);
}

// Initialize visibility of password fields
toggleExportPassword();
toggleImportPassword();
