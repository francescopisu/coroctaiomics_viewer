CoroCTAiomics - portable Windows viewer
=====================================

Windows 10/11, Intel/AMD 64-bit. No Python, Conda, Node, installation or admin
permissions are needed for normal use. Local execution policies still apply.

FIRST USE
1. Extract the COMPLETE ZIP into a folder you can read, for example Documents.
   Do not run the launcher from inside the ZIP preview.
2. Double-click "Check Installation.cmd". It should report "status": "ok".
3. Double-click "Start Viewer.cmd". Keep its console window open.
4. The first start imports the included patient. This can take a few minutes.
   Subsequent starts reuse the imported data. A browser then opens the viewer.
5. Press Ctrl+C in the console to stop the application.

The browser and server run entirely on this PC, using 127.0.0.1. No internet
connection is needed. The default port is 8765; another free port is selected
automatically if it is occupied. The URL is printed in the console.

PATIENT STORAGE AND ADDITIONAL CASES
Patient data are stored in %LOCALAPPDATA%\CoroCTAiomics, under the CURRENT
Windows user. Ensure you test using the same user account as the demonstration.
Each case can use several GB of disk and browser/GPU memory.

To add a prepared patient, open the Patients page, click "Import patient" and
select its .cctacase file. Keep the page open while importing. Refresh shows
the new case immediately. Existing patient identifiers cannot be overwritten.

The Mac/cluster exports .cctacase files using the saved models and prepared
imaging data. Each file contains the images, maps and frozen patient AI report.
The demo PC does not perform segmentation, feature extraction or model fitting.
To change a patient's report, export an updated package on the workstation;
replacement of an already imported ID is deliberately not provided in this release.

Application updates can be extracted into a new folder. The same Windows user
continues to use the existing patient storage. Replacing the app does not erase
patients. Included seed files can be removed after successful import if desired.

BEFORE THE DEMONSTRATION
- Test under the actual demonstration user, without "Run as administrator".
- Open P001, rotate both CPRs and the 3D model, scroll the slices, select a
  radiomic map and open AI. P001 should show approximately 12.1%, 9.7%, 83.9, High
  for the exported report supplied with this build.
- Confirm browser hardware acceleration/WebGL2 and appropriate graphics drivers.
- Disconnect the network and repeat the launch.
- Confirm IT execution policies permit the launcher and bundled python.exe.
- "Check Installation" checks native runtime imports. It does not validate GPU
  rendering or substitute for the actual Windows demonstration check above.

TROUBLESHOOTING
Do not disable antivirus/security policies. Have IT approve the application if
blocked. The console displays startup errors. The log is
%LOCALAPPDATA%\CoroCTAiomics\viewer.log. Keep the complete runtime/application
folders together. Do not copy a Mac virtual environment into this package.

The Windows binaries are assembled from official CPython and pinned precompiled
dependencies. See build-info.json for versions, source URL and SHA-256 checksums.
Licenses are retained in runtime and the dependencies' dist-info directories.
