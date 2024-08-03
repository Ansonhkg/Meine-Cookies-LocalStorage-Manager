document.getElementById("exportBtn").addEventListener("click", exportData);
document
  .getElementById("importBtn")
  .addEventListener("click", () =>
    document.getElementById("fileInput").click()
  );
document.getElementById("fileInput").addEventListener("change", importData);

function showStatus(message) {
  document.getElementById("status").textContent = message;
  setTimeout(() => (document.getElementById("status").textContent = ""), 3000);
}

function showError(message) {
  document.getElementById("error").textContent = message;
  setTimeout(() => (document.getElementById("error").textContent = ""), 5000);
}

function exportData() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (chrome.runtime.lastError) {
      showError("Error querying tabs: " + chrome.runtime.lastError.message);
      return;
    }

    const url = new URL(tabs[0].url);
    const domain = url.hostname;

    chrome.cookies.getAll({ domain: domain }, function (cookies) {
      if (chrome.runtime.lastError) {
        showError("Error getting cookies: " + chrome.runtime.lastError.message);
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          function: () => JSON.stringify(localStorage),
        },
        (result) => {
          let localStorage = {};
          if (chrome.runtime.lastError) {
            console.warn(
              "Error getting localStorage: " + chrome.runtime.lastError.message
            );
          } else {
            try {
              localStorage = JSON.parse(result[0].result);
            } catch (error) {
              console.error("Error parsing localStorage:", error);
            }
          }

          const data = {
            cookies: cookies,
            localStorage: localStorage,
          };

          const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          chrome.downloads.download(
            {
              url: url,
              filename: `${domain}_data.json`,
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
    });
  });
}

function importData(event) {
  const file = event.target.files[0];
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) {
          showError("Error querying tabs: " + chrome.runtime.lastError.message);
          return;
        }

        const url = new URL(tabs[0].url);
        const domain = url.hostname;

        // Import cookies
        data.cookies.forEach((cookie) => {
          chrome.cookies.set(
            {
              url: `http${cookie.secure ? "s" : ""}://${cookie.domain}${
                cookie.path
              }`,
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              expirationDate: cookie.expirationDate,
            },
            function () {
              if (chrome.runtime.lastError) {
                console.error(
                  "Error setting cookie:",
                  chrome.runtime.lastError.message
                );
              }
            }
          );
        });

        // Import localStorage
        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            function: (localStorageData) => {
              for (let key in localStorageData) {
                localStorage.setItem(key, localStorageData[key]);
              }
            },
            args: [data.localStorage],
          },
          () => {
            if (chrome.runtime.lastError) {
              showError(
                "Error setting localStorage: " +
                  chrome.runtime.lastError.message
              );
            } else {
              showStatus("Data imported successfully");
            }
          }
        );
      });
    } catch (error) {
      showError("Error parsing imported data: " + error.message);
    }
  };
  reader.readAsText(file);
}
