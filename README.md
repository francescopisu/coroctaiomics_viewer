# Coronary / CPE viewer

Standalone browser viewer with a **patient browser** and one active imaging case at a time. Patients **1, 8, 1718 and external P001** are registered and prepared. Five linked views: 3D coronary overview on the left; independently rotating straightened reconstruction and curved CPR in the center; orthogonal cross-section above native axial CCTA on the right. Vessel-specific radiomic feature maps can overlay the CCTA. All source medical data and the CoroCTAiomics pipeline are read-only. Generated files stay here.

## Local startup

Use Python **3.9+**, Node **20.19+ / 22.12+**, and a WebGL2 browser. The external drive must be mounted when inspecting or preparing the cache. The existing Python environment and node_modules have already been installed in this project.

From the parent `viewer/` directory:

```sh
cd coronary_viewer
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
.venv/bin/python -m backend.prepare
npm run build
.venv/bin/python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000 --no-access-log
```

Open **http://127.0.0.1:8000/** to select a patient. Direct links such as **http://127.0.0.1:8000/viewer/1718** work on refresh. Build the frontend before starting this single-server mode. The backend serves only catalogue-registered generated case assets and the built frontend; it does not expose arbitrary source paths, accept file uploads, or modify data.

For frontend development, run the backend in one terminal and `npm run dev` in another. Open **http://127.0.0.1:5173/**; Vite proxies `/api` to the backend. Bind to loopback as shown.

The first page load shows a horizontal 0–100% indicator. Metadata completes the first 2%; decoded bytes for all 3D meshes, all three vessels' native masks/display fields and the single shared native CT/packed-label stack account for the next 96%. Expected sizes come from geometry, so gzip transfer sizes do not cause percentage overshoot. Download streams copy directly into their final buffers. The final 2% completes after all initial views are ready and two animation frames have passed; 100% remains briefly visible before the overlay fades. Controls are inert until startup completes. All vessel data are ready before the controls become active. A feature map loads on its first selection, then remains cached for the current case. Failed startup requests expose the normal error/Reload control instead of falsely reaching 100%.

## Data configuration and cache

`config/catalog.local.json` is the explicit case allowlist: its `cases` array names JSON configuration files relative to the catalogue directory (absolute local configuration paths also work). It currently includes `case.local.json` (patient 1718) and `cases/1.json`, `cases/8.json`, `cases/P001.json`. Each file contains the same source-path schema. `outputRoot` accepts either a patient-named directory or `{patientId}/output`, while retaining the patient-ID check. Override the catalogue location with `CORONARY_CATALOG_CONFIG`. IDs must be unique; no case is exposed merely because a cache or clinical record exists. The frontend contains no `/Volumes/` paths.

The root page and `/patients` show a compact searchable/sortable table with age/sex, CAD-RADS, both model probabilities and Risk category (from the PRI-only model). Search, sort and filter are reflected in the URL and survive returning from the viewer. The list downloads only `/api/patients` metadata: no meshes, CT buffers or feature maps. Its AI summaries come from the validated local AI reference, only for registered cases; missing clinical records/AI data show dashes. A registered case with missing/stale images is visibly unavailable. Refresh rechecks the catalogue. The large VTK/viewer module is loaded only when opening a patient.

Click a row, or focus the patient link and press Enter, to open `/viewer/{patientId}`. The toolbar and loading screen identify the patient; **← Patients** returns to the preserved list. Loading can be cancelled from its own return control or browser Back. Only one viewer is mounted: navigating away aborts downloads, destroys scenes/WebGL objects and releases case buffers/maps. AI state is mounted with that patient and is never reused across cases. Vessel, centerline index, native axial slice and both CPR angles are remembered per patient in session storage; reopening/reloading restores those controls after validating/clamping them against the selected case. Imaging data load again when reopening, rather than retaining several patients' large CT buffers.

To register another patient:

1. Create `config/cases/{patientId}.json` with matching CT/output/centerline paths and optional feature-map directory, following the existing case files.
2. Add that filename to `config/catalog.local.json`.
3. Prepare just that patient with `.venv/bin/python -m backend.prepare --case {patientId}`.
4. Refresh the patient list. No frontend rebuild or case-selection writes are needed.

`config/case.local.json` remains the default for preparation without `--case`, inspection and the legacy `/api/case` diagnostic endpoint. `CORONARY_CASE_CONFIG=/absolute/path/to/config.json` switches to single-case mode when no explicit `CORONARY_CATALOG_CONFIG` is supplied. This supports existing isolated workflows. Choosing a patient in the UI never edits either configuration file. Existing imaging/AI endpoints now enforce catalogue membership and each case's own fingerprint; changing one case does not invalidate another. Keep patient IDs unique if editing the default configuration while using the catalogue.

### Updating one case's CCTA

1. Update **all matching case fields** in `config/case.local.json`: `patientId`, `ct`, `outputRoot`, each `centerlineFiles` entry, and `radiomicFeatureMaps` if used. Centerline branch suffixes can differ between patients; inspect the actual `labeling/` directory. For case 1718 the verified files are `1718_LAD_1.csv`, `1718_LCx_2.csv`, and `1718_RCA_1.csv`.
2. From `coronary_viewer/`, run `.venv/bin/python -m backend.prepare` for the default, or `.venv/bin/python -m backend.prepare --case {patientId}` for another catalogue entry. This validates alignment and regenerates only that case's cache when needed.
3. **Reload the browser.** No frontend rebuild or server restart is required for subsequent data-only changes.

Editing the JSON is not a live image replacement. The viewer requests `/api/cases/{patientId}` from its URL, returning only that case’s prepared HTTP URLs. The API rejects a missing or stale cache with a preparation instruction instead of silently serving a previous patient. A configuration digest covers that case's JSON and pipeline defaults. Mixed patient IDs, CCTA filenames, output directories and centerline filenames are rejected during preparation. The backend’s axial memory-map cache includes patient ID and preparation revision, so rebuilding a case reopens its arrays. Configuration/source edits during preprocessing abort manifest publication.

The discovery code parses literal assignments from the pipeline's `config/defaults.py` with Python's AST. It does not import the pipeline, initialize torch, or edit global defaults. Directory names and MPR settings come from that file. CPE discovery refuses a configuration other than `periluminal_r4`. Neither `periluminal` nor `periluminal_r4_PCAT` is used.

Preparation fingerprints the source paths, sizes, modification times and configuration. An unchanged case reuses its cache. `python -m backend.prepare --force` regenerates display assets; it never writes source files. Missing files fail explicitly, including a missing `/Volumes/X9Pro` mount. An existing prepared cache can be viewed without the external drive; it is a local derivative of the configured case, never substitute data.

The cache retains native marching-cubes meshes and separate smoothed display meshes for the postprocessed lumen masks, three authoritative CPE masks, and ascending aorta shell. Display surfaces use VTK windowed-sinc smoothing (40 iterations, passband 0.03, normalized coordinates, boundary/feature/nonmanifold smoothing off), with consistent point normals and Phong shading. Connectivity is retained; there is no mesh decimation or source-mask overwrite. The manifest records maximum vertex displacement. For case 1718 it is 0.37–0.48 mm, and enclosed volume changes are below 0.7%. Gear menu → Smooth meshes restores the original mesh when disabled. This is an established VTK display method, not a claim to reproduce Elucid’s proprietary implementation. Optional source VTPs are inspected but not used for display.

Interactive CPR shares the full native CT buffer and its VTK image with axial viewing. It downloads and retains all three vessels' lumen/CPE mask crops and smooth display fields during startup. CT crop assets remain diagnostic references and are no longer downloaded by the viewer. The CPU sampler converts crop indices to the shared native CT grid, preserving trilinear sampling, native HU, crop boundary behavior and physical LPS coordinates. Masks retain their original crop geometries and interpolation policies. The two central viewports use one WebGL context; their CT texture remains the same object when the selected vessel changes. Clicking the 3D model or changing the vessel selector switches resident data without a request or a Loading placeholder. All resources are released when the case closes. Startup retains more mask data, while sharing CT avoids three duplicate CT crops. For case 1718, resident vessel masks/display fields total about 426 MB and the shared native CT/packed-label stack about 270.5 MB before textures and meshes. No spatial downsampling is used; integer HU are compacted losslessly and fractional HU retain Float32.

For axial viewing, preprocessing exports the complete native CT stack and a packed mask stack in x-fast voxel order under `cache/{patientId}/`. The browser downloads both once during the initial progress bar and retains them in memory for every vessel and native k slice. CT is compacted to Int16 only when all HU are preserved exactly; fractional HU retain Float32. Slice CT arrays are zero-copy views into the resident stack, and lumen/CPE masks are decoded locally. The selected radiomic map also supplies native axial values, support and display boundaries directly from its already loaded crop. There are no per-slice HTTP requests, transient Loading frames, or a 16-slice eviction limit during navigation. Case 1718 adds about 270.5 MB of resident axial CT/packed labels. Existing valid caches are upgraded by `python -m backend.prepare` using their saved native arrays without regenerating meshes. The read-only `/api/cases/{patientId}/axial/{k}` and feature axial endpoints remain available for diagnostics and sampling checks; the internal NumPy arrays remain unlisted. Earlier fixed reformats are diagnostic references.

### Radiomic feature maps

The optional `radiomicFeatureMaps` configuration key points to a directory containing vessel subdirectories `LAD`, `LCx`, and `RCA`. `LM-LAD` is accepted as an alias for `LAD`; having both is rejected as ambiguous. Each directory's `.nii.gz` files appear only for that vessel, using their original feature names. macOS `._` resource forks are ignored. Case 1718 has three LAD, two LCx and three RCA maps. A flat pipeline map folder is also supported: `{patientId}_{LAD|LCX|RCA}_{feature}.nii.gz`. The case prefix is checked and removed from display names; mixed patient IDs, mixed flat/folder layouts and duplicate maps fail explicitly. P001 uses this layout with 3 LAD, 4 LCx and 4 RCA maps, without reorganizing its source files.

After changing this directory or its files, run preparation and reload the browser. Preparation fingerprints every discovered map and requires its shape and physical affine to match the CCTA. A mismatched map fails explicitly rather than guessing registration. Display derivatives keep native voxel spacing and crop only the bounding box around the authoritative vessel CPE. Values are stored as Float32; original NIfTI files remain untouched. Per-feature 2nd/50th/98th percentiles are calculated from finite CPE voxels for the optional display stretch. Support is the corresponding `periluminal_r4` CPE intersected with finite feature values. Zero is valid, including zero-valued CPE voxels; NaN/Inf and voxels outside the CPE are transparent. The manifest records in-CPE extrema, zero/invalid counts, and nonzero values outside the CPE within the crop. Some supplied case-1718 maps have nonzero values outside the current CPE, so explicit clipping is necessary.

Choose a map using the toolbar selector; **No feature map** restores the existing CPE display. Selection is remembered separately for each vessel. Each map is fetched once when first selected and retained for the current case, including its VTK images; returning to that map or vessel restores it without another download or a map-loading placeholder. Concurrent requests for the same map share one promise, and closing the case aborts pending requests and releases cached resources. The provided 256-color green–white–pink palette uses stops `#3b9b38`, `#4daf4a`, `#ffffff`, `#f781bf`, `#e66aac`.

**Balanced** is the default display scale: each feature's 2nd percentile maps to green, its median to white, and its 98th percentile to pink. Separate linear stretches below/above the median give both halves of the distribution visible contrast; extrema beyond the percentile endpoints are saturated for display only. The three legend labels are actual feature values, including the white median. Green means lower relative values in this mode, and does not imply negative values. Ties, zero padding within the CPE and constant maps can prevent perfectly equal color counts. **Raw zero** preserves the original sign interpretation and symmetric `[-M, +M]` range, with `M = max(abs(min), abs(max))` (1 for an all-zero map). Zero is white in Raw zero; a positive-only feature legitimately uses white/pink. No source values, features, inference or analytical masks are changed. Scale statistics remain fixed during navigation and rotation.

The selected feature overlays both CPRs, the fixed orthogonal slice, native axial CCTA, and the optional 3D cross-sectional plane. Feature scalars are interpolated before color mapping: trilinearly in the CPR and orthogonal plane, bilinearly during axial display enlargement. Interpolation is normalized by finite CPE support, so masked-out background and NaN neighbours do not dilute boundary values toward zero. CPU and GPU share the same scale parameters and colormap. The GPU stores scalar/support channels, divides by interpolated support, and applies its color transfer function afterward. A small OpenGL CPR view-node extension supplies the final color stage and rebuilds it when scale parameters change; vtk.js 37.4.1’s CPR renderer does not apply the generic shader-replacement hook. Its native coordinate/orientation/sampling stages are retained. Original finite zeros remain valid. The 3D vessel surfaces retain territory colors.

**CPE masks** in the toolbar independently toggles all binary CPE display surfaces, fills and contours, preserving vessel-specific selections in the gear menu. Feature maps remain visible when masks are hidden. **Gear menu → Map opacity** adjusts the map independently. Rotation resamples the map while orthogonal/axial orientation remains fixed. The color-scale legend shows the feature name and numeric anchors.

**Gear menu → Smooth edges** controls a separate boundary display derivative, enabled by default. A physical Gaussian kernel with sigma 0.35 mm produces a continuous CPE field; its 0.5 contour, antialiased coverage and rounded vector paths replace voxel steps and suppress thin spurs/small specks. The map is clipped to the same display field. Smoothing can hide small source-mask fragments or shift the displayed edge; disable Smooth edges to inspect the original voxel support. Binary sampling and source NIfTI labels stay unchanged. Display fields are generated independently in each native vessel crop, with halo padding in feature crops.

The optional ascending aorta is discovered at `outputRoot/cardiac_structures/asc_aorta_shell.nii.gz`. An explicit `ascendingAorta` path can override it; a missing explicit path fails preparation. Its own NIfTI affine maps the surface to physical LPS. The gear menu provides Ascending aorta visibility and opacity; it is included in the 3D camera fit. Existing cases without this optional file still load.

### Interaction

- Drag horizontally in **Curved CPR** to rotate around the vessel's longitudinal axis. Each central reconstruction has an independent rotation angle. Rotation in one panel does not rotate the other, the orthogonal cross-section, its 3D plane, or axial CCTA. All views continue to share the selected vessel and longitudinal position.
- Drag horizontally in **Straightened** to rotate its plane around the transported local tangent; click or drag vertically to select a longitudinal position. Gesture direction locks after a small movement threshold, so starting a rotation does not move the selected slice. Click a row in Curved CPR or scroll either reconstruction to navigate. All five views follow the same centerline sample.
- The curved panel uses vtk.js stretched CPR: the vessel retains lateral curvature, and longitudinal display distance is projected perpendicular to its current sampling direction. Its marker uses these projected distances, not a guessed image fraction.
- Select LAD, LCx or RCA in the toolbar or click a vessel in 3D. Clicking axial CCTA selects the nearest centerline sample in physical space.
- The **gear icon** at the far right opens layer visibility, opacity, colors, the optional 3D plane and **W/L** controls for the shared CT window. **Reset** restores the camera and zero rotation in both central views. The former Layers text button and Export button are removed.

The imaging workspace keeps its minimal toolbar, panel names, rotation angle, orientation letters and scale references. **AI** opens a compact nonmodal results panel over the lower-left view. Opening it preserves the size, camera and current position of all five views. Close with ×, the AI button or Escape; tab navigation supports arrow keys. Scientific interpretation and implementation details are documented here.

### CPE volume rendering

The 3D panel opens directly in **CPE volume** with Balanced transfer functions and Unlit lighting. This ray-casts native CCTA voxels within the union of the saved CPE masks. It does not color the outer surface mesh, generate tissue segmentations, or alter the source images. The mode uses the already resident CT and packed native labels: no extra CT download, preparation or restart is required. During initial loading, a cancellable slice-batched operation packs a native-resolution bounding crop. The initial loader completes after the volume is ready; changing the volume settings does not retrigger it. Buffers and rendering objects are disposed when leaving the patient.

**Settings** keeps only overall density, the four HU-band opacity gains and anatomical context opacity. Defaults match the supplied reference: density **0.9**, Fat range **1.05**, Low HU **2**, Intermediate **0**, High HU **2**, context **0.15**. The Anatomy selector, preset/lighting selectors and Cut at section control are removed from the interface. Alternative presets, lighting modes and anatomical rendering remain available internally; cutaway clipping is removed. Band ranges are Fat range (−190…−30 HU), Low HU (−30…30 HU), Intermediate (30…350 HU) and High HU (≥350 HU). The attenuation transfer functions have short continuous transitions between bands. They are independent of the CCTA window/level and the green–pink radiomic colormap. The legend's hover text gives the ranges. These are illustrative display bands, **not validated plaque composition, histology, fat classification or inflammation labels**. Contrast, kVp and partial volume influence attenuation; high HU can include contrast contamination as well as calcium. Only material actually present in the CPE can be shown. See the [SCCT quantitative CCTA consensus](https://pubmed.ncbi.nlm.nih.gov/38849237/).

The native CT is packed as two Float32 channels: **HU × support** and **support**. Mask support is derived from finite CT and the original CPE bits, explicitly excluding the lumen. Trilinearly sampled HU is reconstructed by dividing by interpolated support *before* color/opacity lookup; coverage then scales optical depth rather than acting as a second material. Thus transparent background and voxels in another hidden territory cannot dilute boundary HU, create artificial low-attenuation rims or bleed dense structures into the rendered region. The original native CT and labels are untouched. Per-vessel CPE checkboxes in the gear menu select included territories; their union avoids double-counting overlapping CPEs. The global **CPE masks** button continues to control binary surfaces/2D fills, independently of the CT volume. In volume mode, the colored CPE surface shells are suppressed and lumen/aorta/centerlines use the context-opacity multiplier. The existing anatomical renderer remains the internal fallback if no finite CPE voxels are available, with an inline retry message.

Cinematic lighting uses vtk.js composite ray casting with a warm key/cool fill, volumetric scattering and mask-aware shadow rays; Surface/AO uses local ambient occlusion, and Unlit exposes the attenuation colors without illumination. This is an interactive **cinematic-style approximation**, not Siemens' Monte Carlo path tracer. A small vtk.js 37.4.1 OpenGL factory extension fixes the stock multicomponent shadow/AO lookups to respect CPE support and the appropriate transfer-function rows, and skips empty samples. No voxels outside CPE cast volume shadows. Quality is reduced during interaction and returns to full resolution when stationary. The render-engine capture helpers remain internal; there is no Export control in the viewer.

Native CT sampling is retained without spatial downsampling; for case 1718 the crop adds approximately 85 MiB of CPU arrays plus its GPU texture while retained. Source voxel noise and the finite spatial resolution remain visible, and excluded plaque cannot be recovered by rendering.

Validation includes native HU/oblique geometry/source-immutability checks, cancellable preparation, a rendered four-material phantom with a bright masked-out background, territory hiding/restoration including an all-zero mask, compact volume/gear menus, W/L changes, inline empty-mask recovery, and real cases 1718/8. The phantom verifies colors and transparency numerically, rather than merely checking that a volume actor exists.

### AI patient summary

The AI panel shows the configured patient's **PRI-only** and **adjusted** 4-year MACE probabilities and the **Risk category** derived from the PRI-only model. Patient, Features and Cohort tabs keep secondary information separate from the persistent predictions. Results load only on first opening; reopening the panel uses the resident result. AI errors/retry stay inside this panel and do not interrupt imaging. The AI overlay leaves all imaging views interactive.

- **Patient:** recorded age, sex, ESC RF-CL percentage/class, full CAD-RADS, Agatston score, smoking, hypertension, diabetes, dyslipidemia, dyspnea, chest-pain presentation, CAD family history and BMI. The stored likelihood/class are displayed without recalculation. Unknown, absent and explicitly unspecified information is preserved; none is interpreted as a negative finding. Family history is not a separate Cox predictor; it contributes to RF-CL when that value is calculated from its components. The other report-only fields do not enter the models. The adjusted model uses the original continuous `Clinical Likelihood` and binary `SS45`, which is a separate field from full CAD-RADS.
- **Features:** all eight native patient-level radiomic values, grouped by vessel, alongside their derivation-cohort median, interquartile range (P25–P75) and empirical patient percentile. This tab widens the overlay to fit full feature names and uses single-line rows with content-sized height, showing all eight features without scrolling at desktop viewport sizes. Its toolbar contains only the Model selector; the derivation count stays in the Cohort tab. References use finite native values from derivation patients only, before harmonization/scaling; validation patients never enter these distributions. Display values use four significant digits (IQR limits use three); hover preserves the full precision. HRs follow the chosen PRI-only/adjusted model; directional arrows are omitted. A † marks 95% intervals including 1; hover or focus an HR for its full interval and interpretation. These HRs are per training SD after preprocessing, conditional on the other model predictors, not local voxel risk. Clicking a feature selects its available vessel/map in the viewer. Map colors retain their existing numerical meaning.
- **Cohort:** derivation patient/event counts, median age and percentage of women, plus patient-versus-median comparisons and empirical percentiles for PRI-only risk, age, Agatston and RF-CL. PRI uses the original out-of-fold derivation risks. Percentiles exclude missing values and use midrank for ties. Calcium-score availability is shown explicitly.

The PRI bar has **25% / 50% / 25%** segments and the study's right-closed boundaries: Low ≤ Q25, Intermediate Q25 < risk ≤ Q75, High > Q75. Thresholds are read from the saved **out-of-fold derivation** configuration (currently 6.4473% and 10.5730% at 48 months), cross-checked against the PRI bundle. Hover a band/tick to see the threshold. The optional `priOofReference` JSON supplies the original out-of-fold PRI-only risk distribution. Its model, horizon, patient count and quartiles must match the derivation cohort and study thresholds before export. When available, the empirical percentile appears in a dedicated Percentile column between Adjusted and Risk category (e.g. 83.9 for P001), positions the white marker on the bar, and appears in the Cohort comparison table. The calculation is `100 * (number below + 0.5 * number tied) / reference count`, using the full-precision patient risk. External/validation cases never enter this distribution. Without this reference, the percentile is unavailable and the marker remains centered in the assigned category; no percentile is inferred from thresholds or in-sample refitted risks. The feature/age/calcium/RF-CL percentiles are actual empirical values. Feature percentiles are descriptive positions in the native-value derivation distribution, not risk percentiles or preprocessing-adjusted contributions. Cox HR interpretation follows the [lifelines survival-regression documentation](https://lifelines.readthedocs.io/en/latest/Survival%20Regression.html#interpretation).

### AI data and model preparation

`config/ai.local.json` points to the derivation and validation CSVs, two trusted local saved model bundles, and study threshold JSON, plus optional `priOofReference` pointing to a numerical OOF-reference JSON (currently `config/pri-oof-reference.local.json`). Override with `CORONARY_AI_CONFIG`. AI configuration is separate from imaging configuration, so it does not invalidate or rebuild CT/mesh caches. Patient IDs must be unique across the two datasets; the endpoint returns only the record matching the currently configured imaging case. An absent patient gets an explicit unavailable result, never a demonstration patient. Source paths, reference distributions, model files and all-patient data are not exposed over HTTP.

To recreate the numerical reference in the original analysis notebook, use the same frozen predictions that produced the saved strata thresholds, then point `priOofReference` at the resulting file and rerun export:

```python
import json
from pathlib import Path
import numpy as np

scores = np.asarray(
    cv_results_for_ROC["48months"]["whole"]["PRI"]["rad_only"][2].probas_val_avg,
    dtype=float,
).ravel()
reference_path = Path("/absolute/path/to/coronary_viewer/config/pri-oof-reference.local.json")
reference_path.write_text(json.dumps({
    "model": "PRI-only",
    "prediction_horizon_months": 48.0,
    "threshold_source": "Derivation-cohort out-of-fold PRI-only 4-year risks",
    "risks": scores.tolist(),
}, allow_nan=False))
```

Prepare AI data once in an analysis environment. In this workspace `.venv-ai` uses the existing analysis environment with a project-local neuroCombat dependency; the export command is:

```sh
PYTHONDONTWRITEBYTECODE=1 .venv-ai/bin/python -m backend.export_ai
```

To create an independent export environment instead, use Python 3.10+:

```sh
python3.10 -m venv .venv-ai
.venv-ai/bin/python -m pip install -r requirements-ai.txt
.venv-ai/bin/python -m backend.export_ai
```

This command **does not fit models or execute the notebook**. It reads trusted local bundles using pandas' legacy pickle compatibility reader, extracts numerical parameters for site-only ComBat, saved scaling, the Cox coefficients/centering and baseline cumulative hazard, then validates predictions against neuroHarmonize and the saved lifelines models for every complete record and single-record site cases. Old serialized sklearn estimators are never invoked. For the supplied 1,410 records, both models match within 3.4 × 10⁻¹⁶ absolute risk. Only after validation does it atomically publish `cache/ai/reference.json`; no source data, notebooks, pickles or thresholds are modified. The main `.venv` needs no additional inference dependencies and never unpickles a model on an HTTP request.

Inference uses a fixed model schema. In particular, **continuous RF-CL stays numeric even for a single patient**, correcting the notebook helper's `nunique() <= 10` categorical inference for integer clinical fields. This agrees with the batch/reference model; patient 96's corrected adjusted risk is 11.4899%, rather than the notebook's saved 13.19% example. Patient 1718 is currently 12.4859% PRI-only, 10.9402% adjusted, High PRI stratum. These are model outputs, not historical patient outcomes.

Historical `TIME` and `EVENT` values never enter inference or patient responses. The adjusted notebook's numeric imputer includes these outcome columns in its saved design, so this integration requires all eight radiomic inputs, known KVP and (for adjusted risk) recorded RF-CL/SS45. Missing predictors or unseen KVP explicitly disable the affected prediction rather than using outcome-dependent imputation. Supporting incomplete model inputs would require a reviewed, outcome-free preprocessing artifact; reporting fields may remain missing without blocking inference.

Repeat export after changing CSVs, models, threshold files or AI configuration, then reload the page. Mounted source changes are detected by size/modification fingerprints and rejected until re-export. A validated cache remains usable when source storage is unmounted. The AI cache contains patient records and is covered by `cache/` in `.gitignore`; do not distribute it as a frontend asset.

### External patient inputs

P001 is registered in `config/cases/P001.json`, with the original CT at `/Volumes/X9Pro/datasets/new/P001/P001.nii.gz` and pipeline data under its `output/` directory. Reprepare with `.venv/bin/python -m backend.prepare --case P001`. Images, scalar CSVs, source maps and the upstream pipeline stay read-only.

A case can specify `aiInput.radiomicsCsv` and optional `aiInput.clinicalJson`. Relative paths resolve from `coronary_viewer/`. The scalar CSV uses one row per `artery_label` (LAD, LCX, RCA). Signature features are joined by vessel and exact feature name; CSV row order is irrelevant. Duplicate vessel rows, conflicting patient IDs, malformed columns and non-finite numeric inputs are rejected. A missing feature remains unavailable rather than being filled with zero. Voxelwise maps are display inputs and do not substitute for the scalar signature values.

`config/patients/P001.json` contains the user-supplied **120 kVp** and currently null clinical/reporting fields. Fill continuous `Clinical Likelihood` and `SS45` (`Yes`/`No`) to enable adjusted inference, and add the recorded class/demographics/clinical summary when available. Clinical JSON must identify the same `patientId`. After editing this JSON, reload the viewer or leave and reopen the patient to fetch the updated AI result. Toggling the AI panel alone retains its resident result. No imaging preparation or AI-model export is required. There is no imputation or default acquisition/clinical value. Required missing inputs leave the affected prediction unavailable while the feature/cohort views remain usable. The external scalar CSV must remain accessible for AI loading, even when prepared images are retained locally.

External records use the saved numerical ComBat transforms, scaler, Cox model and risk-category thresholds. They never enter the derivation/validation patient export, cohort statistics or reference percentiles, and do not refit any model. `EVENT`/`TIME` and other unlisted metadata are ignored. The patient list uses the same external-record loader as the AI panel. External inputs cannot override an existing cohort patient ID. Source paths and full CSVs are not HTTP assets.

P001's recorded extraction settings match the existing case-8 scalar export (1 mm isotropic resampling, bin width 10, no normalization, outlier setting 2.58, Original/Wavelet). Its cluster build reports PyRadiomics `0.post1.dev0+g6a761c4`, whereas the existing export reports `v3.0.1`; identical settings alone do not establish feature equivalence between builds. P001's PRI-only prediction was independently compared against the saved lifelines/neuroHarmonize calculation, with absolute risk error below 5 × 10⁻¹⁷. This checks inference arithmetic separately from radiomics extraction.

### Component-based clinical likelihood

`backend.rf_cl.calculate_pretest(components, clinical_data=None, *, chest_pain_absent=False, symptom_score=None)` takes one patient dictionary and returns a new dictionary, without saving or modifying the input. The optional array has the original `[age, risk-factor band, sex, symptom band]` axes and shape `(5, 3, 2, 3)`. The default is a read-only numerical copy of all 90 cells in the original study's `clinical_data.pkl`; no runtime pickle or source-drive access is needed.

The function recounts **hypertension, dyslipidemia, current/former smoking, diabetes and premature CAD family history**. It ignores a previously supplied `Number of risk factors`. Unknown factors stay unknown: the exact count is null, with a known-positive count and possible total range. A percentage is returned only if every possible count selects the same numerical lookup value; an ambiguous value raises an explicit error. An unknown symptom never becomes absent automatically. Confirm absence with `chest_pain_absent=True`, `Chest Pain: No`, or the explicit `Type of chest pain : No chest pain` value. The misspelling `Dyslipdemia` is accepted as an input alias and normalized to `Dyslipidemia`; conflicting aliases fail. Ages outside the published 30–80-year table fail rather than silently extrapolating.

```python
from backend.rf_cl import calculate_pretest

result = calculate_pretest(components, chest_pain_absent=True)
# result is JSON-compatible for JSON-compatible component inputs.
```

For the supplied 42-year-old man with dyslipidemia and smoking, no hypertension/diabetes/dyspnea, confirmed absence of chest pain and unknown family history, the total risk-factor count is **2–3**, the lookup group is **2–3**, and clinical likelihood is **4% (Very low)**. CAD-RADS `Score 2` gives `SS45: No` according to the study's existing CAD-RADS 4/5 definition. CAD-RADS does not enter the RF-CL lookup itself. Patient JSON remains manually editable; the viewer does not silently recalculate or replace stored RF-CL values.

**Symptom-coding provenance:** the default preserves the pasted cohort function exactly: atypical pain = 1, typical = 2, rest pain = 3, plus 2 for dyspnea, capped at 3. This is not the symptom definition in [ESC 2024 Figure 4](https://doi.org/10.1093/eurheartj/ehae177), where chest-pain characteristics generate a 0–3 score and exertional dyspnea is an alternative 2-point presentation. Pass an independently assessed `symptom_score=0/1/2/3` to select that score explicitly; the returned `RF-CL symptom coding` records the choice. Existing cohort predictors and fitted models remain unchanged. The refactor was cross-checked against the original dataframe function in 480 complete-input combinations spanning all lookup cells and cohort symptom combinations.

## Inspection findings

`python -m backend.inspect_case` inspects the default case; `--case {patientId}` inspects a catalogue case. Reports with image headers, geometry, alignment diagnostics and VTP metadata are written to `cache/{patientId}/inspection.json`. The legacy `cache/inspection.json` describes only the default case; preparing/inspecting another patient does not overwrite it. The following table records the original case-1 inspection:

| Item | Finding |
| --- | --- |
| CT and six display masks | 512 × 512 × 416; identical affines and grids |
| Spacing | 0.431640625 × 0.431640625 × 0.300000012 mm |
| Physical LPS origin | (−73.284179688, −318.284179688, −346.5) mm |
| LPS direction | Identity; qform and sform codes both 1 |
| Labelled CSV columns | `x,y,z,radius,zone`; explicit field parsing |
| Slicer markups | LPS, mm; matching CSV points |
| LAD | 50 source points; 49.4467 mm; every point inside lumen |
| LCx | 78 CSV points; 76.6888 mm; every point inside lumen |
| RCA | 111 source points; 109.4918 mm; every point inside lumen |
| Centerline to nearest lumen voxel | Maxima: LAD 0.2930 mm; LCx 0.3020 mm; RCA 0.2944 mm |
| CPE/lumen overlap | Zero voxels for all three vessels |
| CPE voxel counts | LAD 60,592; LCx 58,304; RCA 97,920 |

LCx markup has 79 points: it includes an extra initial point absent from the 78-row CSV. All CSV points match markup positions. CSV order and origin are authoritative for navigation; the viewer does not silently prepend that extra point.

Subtree VTPs are triangle surfaces with `Labels` and `Normals`, and no cell or field data. Combined centerline VTPs contain 4 left / 2 right polylines and `MaximumInscribedSphereRadius`, `EdgeArray`, `EdgePCoordArray`, `TCoords`; no anatomical branch labels or coordinate-system field. Their native points align as LPS (median distance to lumen voxels about 0.19–0.23 mm); treating them as RAS instead misses by hundreds of millimetres. The source MRML refers to lumen volumes and centerline markups, with no corresponding transform references found; it is not a runtime dependency.

The MPR implementation allocates `(mpr_width, mpr_width, centerline_count)` and multiplies transverse pixel offsets by `mpr_voxelsize`. **MPR_WIDTH = 50 is pixels, not millimetres:** the default field of view is 25 mm. Pixel centres span −12.25…+12.25 mm; image support spans 25 mm.

The periluminal extractor multiplies local radii by four, subtracts the lumen, and clips against dilated cardiac, pulmonary and additional masks. LCx also gets an origin skip based on 1.5 times a nearby LAD radius. Saved CPEs can therefore be incomplete shells. The UI shows the exact saved masks rather than rebuilding the ideal mathematical envelope. The nominal 50 mm length, CSV length and range of cross-sectional planes intersecting the CPE are distinct. The latter can extend beyond 50 mm because a curved outer envelope intersects later planes; the diagnostic manifest records this as `cpeSliceRangeMm`, independently of nominal analyzed length.

## Coordinate and sampling contract

All geometry in the viewer uses **physical LPS millimetres**. Nibabel's affine maps voxel-centre indices to RAS. We use:

```text
F = diag(−1, −1, 1, 1)
A_LPS = F × A_NIfTI_RAS
p_LPS = A_LPS × [i, j, k, 1]
ijk = inverse(A_LPS) × [p_LPS, 1]
```

The CSV already contains LPS coordinates, verified by its associated markup and by lumen occupancy. No visual axis flipping or additional half-voxel offset is applied. Nibabel arrays are indexed `data[i,j,k]`; mesh vertices and reslices follow that convention. Out-of-volume CCTA sampling returns −1024 HU, labels return 0.

Centerlines are resampled linearly by physical arc distance, preserving path order. Local tangents use centred finite differences. Transverse U/V axes use minimal-rotation parallel transport and orthonormalization, with an explicit error on a direction reversal. The straightened mapper uses these per-point orientations; its sampling direction is `cos(straightAngle) U + sin(straightAngle) V`. The orthogonal plane samples `P(s) + u U(s) + v V(s)` from the same native volume, independently of both central rotation angles, with trilinear CT and nearest-neighbour masks. It also drives the optional 3D plane and ring.

The per-point straightened orientation array contains normalized **four-component quaternions with continuous signs** (`dot(q[i-1], q[i]) >= 0`). Rotation matrices converted independently can produce opposite-sign quaternion pairs for nearby frames, even though the physical orientations are smooth. The vtk.js 37 GPU interpolation path does not correct those sign changes; it can interpolate the long rotation and produce narrow horizontal sampling seams. The viewer resolves this ambiguity before uploading orientations, preserving the exact original frame axes. Regression tests exercise the actual case-1 LCx/RCA sign-change locations and compare GPU-style interpolation to independent shortest-arc interpolation. The curved uniform-orientation renderer does not have this adjacent-frame ambiguity.

The curved mapper uses `vtkImageCPRMapper.useStretchedMode` with a uniform sampling direction perpendicular to the vessel's first-to-last chord. A normalized quaternion rotates that direction; the GPU uniform requires four quaternion components even though the core orientation API also accepts matrices. The shader samples `P(s) + (x + dot(C-P(s), D)) D`. Its width is fixed for the entire rotation envelope: `25 + 2 × max(distance of P−C perpendicular to the chord)` mm, where C is the mean centerline point. Crop bounds already cover this full envelope. The selected curved marker is at `width/2 + dot(P-C,D)` horizontally and the corresponding projected centerline distance vertically. This is a single curved reformation, not a MIP or a slab average.

The curved CPR yellow section marker is a single straight segment through the selected vessel point. Its angle comes from the selected orthogonal U/V frame and the local tangent plane of the stretched CPR, including the longitudinal display scale. With unit frame normal N, sampling direction D and scale k, its mapper direction is `(length(cross(N,D)), dot(N,D) × k)`. After projection, its displayed length is fixed at 96 CSS pixels (capped at 36% of the smaller panel dimension for small views). It is an orientation indicator; its displayed length does not represent a physical diameter or FOV. Length is independent of rotation and the stretched longitudinal scale. This local orientation guide remains straight through vessel bends; tracing the entire orthogonal plane across the curved ribbon previously produced wavy markers. The straightened marker stays horizontal. Both markers and their center dots are also drawn in PNG export; changing CPR rotation does not rotate the orthogonal frame itself.

Both central views sample the same fixed vessel-dependent width given above, so their CT image rectangles match horizontally. The straightened FOV expands to the full rotation envelope; its vessel remains centered, with additional surrounding CCTA visible. Existing native crops already cover this sampling width. Both views have the same longitudinal display extent, `displayHeight = max(CSV_length, fixed_curved_width / viewport_aspect)`, and share one camera scale. The camera contains the complete image rectangle and reserves half the screen marker length plus 8 CSS pixels around the full centerline rotation envelope and the longitudinal ends. This padding and the camera scale are computed per vessel and viewport, independently of the rotation angle. Horizontal pixels per millimetre are identical between panels and remain constant during rotation. The longitudinal coordinates are scaled by `displayHeight / mapper_height`, preserving the requested matched, full display heights even when a wide rotation envelope controls camera fit; this axis is therefore a display coordinate, not an isotropic measurement surface. Native sampling resolution, arc/projected-distance lookup, point selection and the 3D marker remain unchanged. The former angle-dependent width and per-view `CSV_length × view_width / 25` fitting caused artificial vessel thinning through rotation; this combination has been removed. Real contour differences can remain because a uniform stretched-CPR sampling direction is not generally perpendicular to every local tangent; use the linked orthogonal section to assess a true transverse diameter.

Straightened CPR rotates a local sampling plane along the path, so distant background can be stretched, compressed or folded. Matching the straightened FOV to the curved rotation envelope makes this much more visible than a narrow vessel-focused strip. For case-1718 RCA the width is about 80.4 mm; at 6° and 40.2 mm lateral offset, consecutive 0.5 mm centerline samples can reach source positions about 6.34 mm apart. This is geometric distortion, with additional aliasing when output pixels span multiple native CT voxels. Frame quaternions remain sign-continuous; this is separate from the earlier quaternion seam bug.

**Gear menu → Pixel antialiasing** enables adaptive pixel-footprint filtering of the straightened CCTA, on by default. The fragment shader estimates native-voxel footprint using screen derivatives of the 3D sampling coordinates before the volume-bounds branch. It integrates 1–16 trilinear CT samples along the dominant footprint direction before windowing. Pixels spanning no more than one native voxel retain the original single sample. This is a display prefilter, not a through-plane MIP/AVG slab; the centerline, transported frames, coordinates, source CT, masks, feature values, curved CPR and orthogonal/axial slices are unchanged. Broad geometric distortion remains; antialiasing reduces fine undersampling artifacts rather than reconstructing undistorted distant anatomy. The toggle restores the unfiltered rendering for comparison. A high-frequency synthetic background verifies reduced aliasing while its vessel-core pixels and other linked views remain identical.

The installed vtk.js 37 CPR shader converts model indices to texture coordinates using `ijk/dim`, while voxel texture centres require `(ijk+0.5)/dim`. At the GPU boundary only, the supplied polyline and curved reference point are translated by half the sum of the affine's three spatial columns. This compensates the shader convention. The native image affine, source points, CPU sampling and navigation are not changed. Mask actors use the mapper's supported opaque pass with scalar alpha, preserving visibility and blending of zero-background labels.

Cross-sections use a **200 × 200 display sampling grid at 0.125 mm** over the original 25 mm FOV. CT remains trilinearly sampled from the native voxel data; this increases display sampling density, not acquired spatial resolution. Binary lumen/CPE samples are still retained with nearest-neighbour interpolation for scientific checks. The separate continuous display field samples the lumen trilinearly and, when Smooth edges is enabled, the Gaussian CPE display field; marching squares extracts its 0.5 isocontour. Antialiased vector paths replace painted pixel-edge borders and use even-odd filling to retain the lumen hole and separate components. Exact diagonal saddle ties keep foreground components separate. Local quadratic corner rounding is limited by one contour sampling interval; no global spline, circle fitting, source-mask overwrite, resegmentation or analytical measurement changes are introduced. These contours are display derivatives, comparable to the existing marching-cubes display surfaces, not new scientific labelmaps.

The cross-section is composited at 1024 × 1024 with approximately 1.5 CSS-pixel contour strokes. The 5 mm bar uses the actual display spacing. The optional 3D plane uses the same finer CT samples, fixed transported frame and matching physical pixel-centre extent. Axial labels retain the existing native raster display.

Both right-hand views support mouse-wheel navigation and left-button vertical dragging (4 CSS pixels per slice). Down advances and up reverses. The orthogonal view steps along the selected vessel centerline; the axial view steps through every native CT k slice, including slices outside the vessel extent. Axial navigation selects the nearest centerline point to the previous point projected onto the new native plane; outside the available centerline the vessel marker stays at the nearest available point. Navigating from the CPR, cross-section or 3D vessel clears the axial override and returns to the native slice through the selected point. A stationary axial click still selects the closest vessel point; dragging does not trigger that selection. Focus either slice and use Up/Down, Page Up/Down or Home/End for keyboard navigation. The former toolbar distance slider is removed.

The axial crosshair has red horizontal and green vertical arms, a central gap, and reference ticks. Its intersection retains the selected point's continuous native i/j coordinates. The displayed slice number is one-based. Both 2D views show orientation labels and an LPS cube projected from their actual image-plane axes. The 3D cube follows the camera; L/R are red, P/A green and S/I blue. Orthogonal orientation remains independent of both CPR rotations. Cubes and the axial crosshair are also included in PNG export. The backend preserves the original native matrix and bit masks; the axial endpoint is read-only and rejects indices outside the volume.

The orthogonal **Lumen Øeq** reference is `2 × sqrt(area / π)`, calculated from the unsmoothed, nearest-neighbour lumen component containing (or within 0.5 mm of) the selected centerline point. Area uses the actual cross-section grid spacing. Disconnected neighbouring lumens are excluded. Missing or FOV-clipped components display a dash. This is an area-equivalent diameter, not a minimum diameter or a stenosis estimate; smooth display contours, layer visibility, windowing and CPR rotation do not change it.

vtk.js **37.4.1** provides the GPU straightened and curved renderers. See [ImageCPRMapper documentation](https://kitware.github.io/vtk-js/api/Rendering_Core_ImageCPRMapper.html). CT, feature scalars and binary masks retain separate interpolation policies. The 3D texture uses the same cross-section samples, fixed transported frame and physical coordinates. The lime ring is a navigation marker. CPE colors can be customized; visibility and opacity changes are synchronized. vtk actors, textures, observers and render resources are disposed on unmount.

CPEs are predefined lumen-excluded radiomic sampling regions. They are not segmented fat, plaque, inflammation or voxelwise disease attribution. Supplied voxelwise radiomic features are displayed as input data; the AI panel separately computes patient-level Cox inference from recorded scalar features. No voxelwise PRI risk predictions, chamber modes, patient database service, cloud deployment, annotation editing or reporting are included.

## Verification

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
npm run build
# With the dev servers running:
npx playwright test
# Or against the built frontend served by the backend:
CORONARY_TEST_URL=http://127.0.0.1:8000 npx playwright test
```

On macOS, browser tests use an isolated headless Google Chrome at `/Applications/Google Chrome.app`. On Linux, install Playwright Chromium with `npx playwright install chromium`. The browser tests exercise real case loading, GPU CPR drag rotation, all vessel selections, longitudinal navigation, linked axial and orthogonal slices, layer visibility, windowing and reset, and reject browser and GPU console errors. HTTP checks reject unknown patients, unlisted assets and writes. Geometry tests cover oblique affines, RAS/LPS conversion, voxel-centre conventions, interpolation, frame continuity, actual source alignment, mask exclusion, cached CT samples against direct source sampling, native crop affine/order/value preservation, full-rotation CPR crop coverage, matched rendered CPR heights, and subpixel contour/component/hole preservation.

Feature checks additionally compare every prepared map against its original NIfTI values and native axial placement, verify explicit support/zero/nonfinite handling and grid rejection, and exercise vessel-dependent selection, the palette, opacity, independent rotation with a map active, restoration of the CPE display, and PNG export.

A separate synthetic bowed tube of known 4 mm diameter tests the actual GPU rendering at eight rotation angles. At its axial midpoint, every sampling direction intersects the same circular diameter. Browser screenshots are decoded to measure the bright vessel width, checking physical scale, agreement with the straightened view, and diameter stability to within two raster pixels. This catches magnification changes independently of patient anatomy and of the camera's reported scale.

Screenshot output is under `test-results/`. The viewer has no Export button. `cache/`, screenshots, environments and dependencies are ignored by git.

Display validation also checks native crop sizes, Gaussian speck suppression with lumen-hole preservation, mesh normals/displacement/volume stability, support-normalized interpolation with missing neighbours, balanced/raw palette semantics, aorta visibility, mesh/edge toggles and independent CPE-mask visibility.

A patient-specific on/off audit at standard and Retina pixel densities confirms that the antialiasing toggle is active but often visually subtle. At device scale 2, case-1718 LAD changes about 0.54% of straightened pixels and RCA about 2.94%, with mean maximum-channel differences of 0.0066 and 0.0351 byte levels respectively (W 800 / L 250, straightened angle 6°, default viewport). These are display comparisons, not clinical noise-reduction measurements. Central-column pixels and the curved/orthogonal views are identical. The control is labelled Pixel antialiasing to distinguish it from background denoising or geometric correction.


### Portable Windows demonstration package

The existing viewer is preserved on `main` and `freeze/viewer-2026-11-17` at
`10eb7f5`. Portable work is on `codex/windows-portable`. The standard Mac workflow
and its preparation/configuration checks remain available outside portable mode.

This package targets **Windows 10/11, Intel/AMD x64** and is assembled on the Mac
using official embedded CPython 3.13.17 and pinned Windows wheels. It includes the
compiled frontend and a small runtime (NumPy, FastAPI, Uvicorn and dependencies).
It does not install Python, Conda, Node, system services, registry entries or
packages on the target PC. Graphics drivers and local execution policies remain
properties of the target machine.

Export an already prepared patient on the Mac, with the source drive available
for external scalar radiomics inputs and the validated AI reference prepared:

```sh
.venv/bin/python -m backend.export_patient --case P001 --output releases/P001.cctacase
```

The export contains all listed imaging assets, native axial arrays and the
patient's frozen AI response, including both probabilities, PRI percentile,
feature/cohort references and model revision. It never includes source paths,
source NIfTI files, model pickles or all-patient reference records. No model is
refitted. `--without-ai` is an explicit imaging-only export. Export refuses to
replace an existing output file and aborts if prepared assets/configuration
change while packing. Each payload has a SHA-256 checksum; checksums detect
corruption and are not a publisher signature.

Assemble the Windows distribution (downloads official Windows binaries; no
Windows compiler or Windows machine is required for assembly):

```sh
.venv/bin/python tools/build_windows_portable.py --patient releases/P001.cctacase
```

The output is `releases/CoroCTAiomics-Windows-x64.zip`. Downloaded binaries are
cached in `.portable-build/downloads`; `--offline --skip-frontend` can repeat the
assembly without network access once downloads and the frontend are ready.
Choose a new `--output` directory for later builds: existing releases are
preserved. `build-info.json` records the Python archive URL/checksum, locked
wheel checksums and application-file checksums. Third-party licenses remain in
the runtime and wheel metadata. The embedded interpreter's isolated `._pth`
references only its own standard library, bundled dependencies and application.

On Windows, extract the **entire ZIP**, run `Check Installation.cmd`, then
`Start Viewer.cmd`. The initial P001 package is imported once before opening the
browser. Keep the console open; Ctrl+C stops the loopback-only server. The default
port is 8765, with a free-port fallback if occupied. No remote network interface
is bound. Application data live in the current Windows user's
`%LOCALAPPDATA%/CoroCTAiomics`, so upgrading the application folder preserves
patients. The actual demonstration user needs write access to that directory.
The console and `viewer.log` there record errors. Full instructions are in
`portable/WINDOWS_README.txt` and the ZIP's `READ ME FIRST.txt`.

The portable Patients page has **Import patient**. Import another workstation-
exported `.cctacase` file to add a patient immediately, without rebuilding,
restarting, editing JSON or requesting administrator permissions. Imports stream
to disk, check inventories/checksums/identity/URLs and stage files before atomic
catalogue publication. ZIP traversal, symlinks, Windows device names,
case-insensitive duplicate IDs, wrong-patient AI reports and mixed-patient URLs
are rejected. Existing patients are never overwritten. Import is enabled only
in portable mode and requires a same-origin local request. Ordinary development
mode remains read-only. The portable application reads the frozen AI report;
clinical changes and updated reports are prepared/exported on the workstation.
Replacing an already imported patient ID is intentionally unsupported in this
initial release.

To preview the assembled application with the Mac interpreter (this does **not**
execute or validate Windows binaries):

```sh
.venv/bin/python releases/CoroCTAiomics-Windows-x64/application/portable_launcher.py --check --data-dir .portable-data
.venv/bin/python releases/CoroCTAiomics-Windows-x64/application/portable_launcher.py --data-dir .portable-data
```

Before the demo, run the Windows checks under the **actual standard user** and
test P001's 3D rendering, both rotating CPRs, linked slices, radiomic maps and AI,
then repeat with the network disconnected. A successful Mac preview does not
verify Windows DLL loading, execution policy or the target GPU/browser.


### One-command case preparation and portable export

Edit **`config/prepare.local.json`** and run, from `coronary_viewer`:

```sh
./prepare.sh
```

The current file registers and processes **96, 814 and 893**, using the full
`df_der_no_hf.csv` clinical dataframe, their pipeline output folders and their
`radiomics_r4_iso/maps` directories. This command prepares viewer assets from
existing segmentation/centerline/radiomics outputs; it does not run the cluster
segmentation or feature-extraction pipeline.

The file has shared `pipelineRoot`, `outputRoot`, `ctRoots`, `clinicalCsv` and
`exportDirectory` paths, plus a `cases` list. With the same dataset layout and
clinical table, adding another case only requires adding its patient ID:

```json
{"patientId": "1234"}
```

For exceptional layouts, an entry can override `ct`, `ctRoots`, `outputRoot`,
`clinicalCsv`, `pipelineRoot`, `radiomicFeatureMaps`, `ascendingAorta` or
`centerlineFiles`. For example:

```json
{
  "patientId": "1234",
  "ct": "/path/to/1234.nii.gz",
  "outputRoot": "/path/to/pipeline/1234",
  "radiomicFeatureMaps": "/path/to/pipeline/1234/radiomics_r4_iso/maps",
  "centerlineFiles": {
    "LAD": "1234_LAD_2.csv",
    "LCx": "1234_LCx_1.csv",
    "RCA": "1234_RCA_1.csv"
  }
}
```

Relative paths in the batch file are resolved against `coronary_viewer`, so
running the shell script from another directory has the same result. The script
uses `.venv/bin/python`; `CORONARY_PYTHON` can select an existing alternative
viewer environment. No Conda activation is required.

The command checks all requested cases before registration: unique patient IDs,
source files, one unambiguous CCTA and labelled centerline per vessel, the
matching clinical row, eight scalar features, KVP and adjusted-model inputs.
CT discovery checks the root itself and its immediate dataset subfolders. The
map directory defaults to `<outputRoot>/radiomics_r4_iso/maps`. Multiple CTs or
anatomical branches require explicit paths; the script never picks one by
length or filename ordering.

It writes `config/cases/<id>.json` and allowlisted `config/patients/<id>.json`
records, appends cases to the existing catalogue, then performs geometry checks,
prepares meshes/volumes/maps, computes the saved model predictions and exports
**`releases/patients/<id>.cctacase`**. The generated patient record contains
only model/reporting fields; outcomes, follow-up and unrelated dataframe columns
are discarded. Missing values remain missing. Stored clinical likelihoods are
used as supplied, without recalculation or age/category extrapolation.

For existing derivation/validation patients, `aiRecord` enriches clinical
reporting while preserving the exact frozen prediction inputs and original
cohort membership. If the requested CSV has a different scalar feature, KVP,
RF-CL or SS45 value from the frozen record, preparation stops for review.
External IDs use only their allowlisted input record and never enter the
reference cohort. No coefficients, thresholds, reference distributions or
cohort source data are refitted/edited.

Useful variants:

```sh
./prepare.sh --check-only        # Read-only input/discovery checks
./prepare.sh --case 96           # Process/export only one configured case
./prepare.sh --skip-export       # Prepare only for the Mac viewer
./prepare.sh /path/to/batch.json # Use a different batch path file
```

Unchanged JSON files and prepared caches are reused. A matching existing export
is reused too. If case data/report change, a version-suffixed package is written
instead of overwriting the previous export. Each run writes a summary to
`releases/patients/prepare-report.json`; if one case fails, remaining cases are
attempted and the command exits nonzero with a per-case summary. Generated case
and patient JSONs are managed by the batch configuration, so make lasting path
changes in the batch file rather than those generated files.

Transfer the resulting `.cctacase` files to Windows and use **Import patient**.
The existing Windows application supports them without rebuilding or admin
permissions. The original duplicate-ID protection still applies to previously
imported patients.
