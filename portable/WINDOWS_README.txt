CoroCTAiomics Open Day - Windows portable viewer
================================================

Windows 10/11, Intel/AMD 64-bit. No Python, Conda, Node, installation or admin
permissions are required for normal use. The application works offline.

FIRST USE
1. Extract the COMPLETE ZIP, for example into Documents. Do not run inside ZIP preview.
2. Double-click "Check Installation.cmd". Expected result: "status": "ok".
3. Double-click "Start Viewer.cmd". Keep the console window open.
4. The first launch imports the three patients. Allow a few minutes for this step.
   Later launches reuse the imported data. The browser opens automatically.
5. Press Ctrl+C in the console to stop the application.

PATIENTS INCLUDED
A-001 = 814 (age 45, as configured for the demonstration)
B-002 = 165
C-003 = 96
No P001 is included. The 16-patient radiomic color reference is bundled.
Patient images, radiomic maps, cinematic references and frozen AI reports are included.
No source drive, segmentation pipeline or model files are needed on Windows.

STORAGE
Data are stored under the current Windows account:
%LOCALAPPDATA%\CoroCTAiomics-OpenDay-2026
This is separate from the older CoroCTAiomics demonstration storage, so its
previous patients and reports do not appear in this release.
Allow at least 5 GB free for imported patient data in addition to the extracted ZIP.
Use the same Windows account for rehearsal and the demonstration.

The server listens only on 127.0.0.1. Default port: 8765. If occupied, a free
port is selected automatically. The console prints the URL.

ADDITIONAL CASES
Export a .cctacase patient on the Mac/cluster, then from the extracted folder run:
"Start Viewer.cmd" --import-patient "D:\path\patient.cctacase"
Restart the viewer afterwards. Existing IDs are not overwritten. This simplified
Open Day interface intentionally has no import or settings controls.
Aliases are editable in application\config\viewer.local.json.

BEFORE THE DEMONSTRATION
Run the check and viewer under the actual demonstration account without admin.
Open each patient, rotate the CPRs/3D anatomy, scroll the slices, enable envelopes,
enable radiomic maps and open the AI report. Verify A-001 shows age 45.
Repeat with the network disconnected. Test browser hardware acceleration/WebGL2.
Check Installation verifies Python/native dependencies, not GPU rendering.

TROUBLESHOOTING
Keep runtime and application folders together. Check the console and:
%LOCALAPPDATA%\CoroCTAiomics-OpenDay-2026\viewer.log
If execution is blocked by institutional policies, ask IT to approve the application.
Do not copy a Mac Python environment into this package.

build-info.json records runtime versions, checksums, application hashes and source
revision. Windows runtime execution still needs verification on the target PC.
