import csv
import json

leads = [
    # Category 1: CCTV & Security Hardware OEMs (India & Global)
    {
        "Company Name": "CP PLUS (Aditya Infotech)",
        "Region": "India / Global",
        "Category": "CCTV Hardware OEM",
        "Target Decision Maker Role": "Chief Technology Officer / Head of Product",
        "Recommended Email / Contact": "cto@cpplusworld.com / partnerships@cpplusworld.com",
        "Email Format Pattern": "first.last@cpplusworld.com",
        "Why They Need CamAI": "CP PLUS manufactures CCTV cameras & NVRs but lacks in-house edge YOLOX/ANPR video analytics software to bundle with their hardware to compete with high-end AI cameras.",
        "Custom Pitch Angle": "Turn-key AI Software License / White-Label OEM Bundle for CP PLUS NVRs & Desktop Workstations."
    },
    {
        "Company Name": "Matrix Comsec",
        "Region": "India",
        "Category": "Security & Telecom OEM",
        "Target Decision Maker Role": "VP Engineering / Head of Security Products",
        "Recommended Email / Contact": "tech.partnerships@matrixcomsec.com / product.management@matrixcomsec.com",
        "Email Format Pattern": "first.last@matrixcomsec.com",
        "Why They Need CamAI": "Matrix produces IP surveillance and access control systems. CamAI's YOLOX detection + ANPR + Speed homography adds instant high-value AI capabilities.",
        "Custom Pitch Angle": "Software IP Acquisition or White-Label Licensing for Matrix SATATYA VMS and IP Cameras."
    },
    {
        "Company Name": "Sparsh Surveillance (Samriddhi Automations)",
        "Region": "India",
        "Category": "Make-in-India CCTV Manufacturer",
        "Target Decision Maker Role": "Founder & MD / Chief Innovation Officer",
        "Recommended Email / Contact": "md@sparshsecuritech.com / info@sparshsecuritech.com",
        "Email Format Pattern": "first.last@sparshsecuritech.com",
        "Why They Need CamAI": "Sparsh is India's leading Make-in-India CCTV OEM looking for indigenous AI software stack for government and municipal tenders.",
        "Custom Pitch Angle": "100% Indian Make-in-India Edge AI Video Analytics Stack for Government & Smart City Tenders."
    },
    {
        "Company Name": "Prama India (Prama Hikvision)",
        "Region": "India",
        "Category": "Surveillance Systems Manufacturer",
        "Target Decision Maker Role": "Head of Strategic Partnerships / CTO",
        "Recommended Email / Contact": "partnerships@pramaindia.in / tech@pramaindia.in",
        "Email Format Pattern": "first.last@pramaindia.in",
        "Why They Need CamAI": "Prama builds local surveillance solutions. CamAI provides on-premise desktop monitoring + cloud multi-tenancy without Chinese cloud dependency.",
        "Custom Pitch Angle": "On-Premise Desktop Analytics & Multi-Tenant Cloud Portal with Complete Source Code Rights."
    },
    {
        "Company Name": "Videonetics Systems",
        "Region": "India / APAC",
        "Category": "Video Analytics OEM",
        "Target Decision Maker Role": "Chief Product Officer / VP Strategy",
        "Recommended Email / Contact": "cpo@videonetics.com / contact@videonetics.com",
        "Email Format Pattern": "first.last@videonetics.com",
        "Why They Need CamAI": "Videonetics provides VMS & Traffic management. Acquiring CamAI adds lightweight OpenVINO/YOLOX edge pipeline & desktop Electron client.",
        "Custom Pitch Angle": "Technology Acquisition to augment Traffic ANPR & Speed Enforcement Module."
    },
    {
        "Company Name": "Vehant Technologies",
        "Region": "India / Middle East",
        "Category": "Traffic & Physical Security AI OEM",
        "Target Decision Maker Role": "CEO / VP Research & Development",
        "Recommended Email / Contact": "ceo@vehant.com / rnd@vehant.com",
        "Email Format Pattern": "first.last@vehant.com",
        "Why They Need CamAI": "Vehant specializes in Under-Vehicle Surveillance & ANPR. CamAI offers an integrated 18-page technical briefing with desktop, mobile Telegram bot, and web SaaS.",
        "Custom Pitch Angle": "Acquire complete IP & multi-tenant cloud Edge Functions for Smart City Expansion."
    },

    # Category 2: Smart City & Infrastructure System Integrators
    {
        "Company Name": "L&T Smart World & Communication",
        "Region": "India / Middle East",
        "Category": "Smart City System Integrator",
        "Target Decision Maker Role": "Head of Technology Procurement / Smart City Lead",
        "Recommended Email / Contact": "smartworld@intecc.com / tech.procurement@lntecc.com",
        "Email Format Pattern": "first.last@lntecc.com",
        "Why They Need CamAI": "L&T executes multi-million dollar Smart City CCTV projects for municipal corporations requiring ANPR, speed detection, and GIS floorplan mapping.",
        "Custom Pitch Angle": "Full Software Asset & IP Acquisition for Municipal Traffic Tenders & Command Centers."
    },
    {
        "Company Name": "Honeywell Building Technologies",
        "Region": "Global / India",
        "Category": "Building & Security Systems Integrator",
        "Target Decision Maker Role": "VP Security Products / Corporate Development",
        "Recommended Email / Contact": "hbt.partnerships@honeywell.com / corp.dev@honeywell.com",
        "Email Format Pattern": "first.last@honeywell.com",
        "Why They Need CamAI": "Honeywell integrates security systems worldwide. CamAI offers zero-cloud egress desktop software and instant Telegram incident dispatch.",
        "Custom Pitch Angle": "Commercial Licensing / OEM Integration for Enterprise Security & Building Automation."
    },
    {
        "Company Name": "Siemens Infrastructure (Smart Infrastructure)",
        "Region": "Global",
        "Category": "Industrial & Infrastructure Tech Integrator",
        "Target Decision Maker Role": "Head of Digital Buildings / Venture Partnerships",
        "Recommended Email / Contact": "smart.infrastructure@siemens.com / corp.m-a@siemens.com",
        "Email Format Pattern": "first.last@siemens.com",
        "Why They Need CamAI": "Siemens deploys perimeter protection and smart facility monitoring. CamAI's Zone Studio with polygon drawing fits industrial plant safety.",
        "Custom Pitch Angle": "Factory Safety & Restricted Zone Intrusion Analytics Licensing."
    },
    {
        "Company Name": "Allied Digital Services",
        "Region": "India / US",
        "Category": "Master System Integrator (MSI)",
        "Target Decision Maker Role": "CTO / Executive Director of Solutions",
        "Recommended Email / Contact": "solutions@allieddigital.net / cto@allieddigital.net",
        "Email Format Pattern": "first.last@allieddigital.net",
        "Why They Need CamAI": "Allied Digital deploys Smart City Safe City projects across India & USA. CamAI provides turnkey GIS mapping and live desktop operator grid.",
        "Custom Pitch Angle": "Turnkey Safe City Video Analytics Engine & Multi-Tenant Command Software."
    },
    {
        "Company Name": "Technsys Systems Integrator",
        "Region": "India / Gulf",
        "Category": "Security System Integrator",
        "Target Decision Maker Role": "Director of Technology / BD Manager",
        "Recommended Email / Contact": "projects@technsys.in / bd@technsys.in",
        "Email Format Pattern": "first.last@technsys.in",
        "Why They Need CamAI": "Technsys integrates CCTV for highways and toll plazas. CamAI provides homography speed estimation and ANPR plate recognition.",
        "Custom Pitch Angle": "Toll Plaza & Highway Speed Gate Software Asset Licensing."
    },

    # Category 3: Video Management Systems (VMS) & Software Platforms
    {
        "Company Name": "Milestone Systems",
        "Region": "Global / Europe",
        "Category": "Enterprise VMS Platform Vendor",
        "Target Decision Maker Role": "VP Ecosystem & Alliances / Head of M&A",
        "Recommended Email / Contact": "partner@milestonesys.com / corpdev@milestonesys.com",
        "Email Format Pattern": "first.last@milestonesys.com",
        "Why They Need CamAI": "Milestone XProtect dominates VMS. CamAI provides lightweight OpenVINO edge AI engine and modern React/Supabase cloud portal.",
        "Custom Pitch Angle": "Add-on Analytics Module or Source Code Acquisition for Milestone Marketplace."
    },
    {
        "Company Name": "Genetec",
        "Region": "Global / North America",
        "Category": "Enterprise VMS & Security Center",
        "Target Decision Maker Role": "Director of Product Management / Strategic Alliance Lead",
        "Recommended Email / Contact": "alliances@genetec.com / businessdev@genetec.com",
        "Email Format Pattern": "first.last@genetec.com",
        "Why They Need CamAI": "Genetec Omnicast leads unified physical security. CamAI offers standalone edge desktop app with hardware-bound DPAPI licensing.",
        "Custom Pitch Angle": "Technology Acquisition of CamAI Edge AI Engine & License Control Suite."
    },
    {
        "Company Name": "AllGoVision Technologies",
        "Region": "India / Global",
        "Category": "Video Analytics Product Vendor",
        "Target Decision Maker Role": "Founder & CEO / Chief Product Architect",
        "Recommended Email / Contact": "contact@allgovision.com / ceo@allgovision.com",
        "Email Format Pattern": "first.last@allgovision.com",
        "Why They Need CamAI": "AllGoVision sells analytics modules. CamAI offers complete ready-to-deploy multi-tenant cloud backend with 21 Edge Functions.",
        "Custom Pitch Angle": "Acquire CamAI Cloud Architecture, Desktop Workstation & Telegram Bot Pipeline."
    },

    # Category 4: Managed Security Services (MSSP) & Surveillance Monitoring
    {
        "Company Name": "SIS Limited (Security & Intelligence Services)",
        "Region": "India / Australia / APAC",
        "Category": "Security Services & Guarding Giant",
        "Target Decision Maker Role": "Group CTO / Head of Digital Transformation",
        "Recommended Email / Contact": "digital@sisindia.com / cto@sisindia.com",
        "Email Format Pattern": "first.last@sisindia.com",
        "Why They Need CamAI": "SIS employs thousands of security guards and is actively upgrading to 'AI-assisted Virtual Guarding' and central remote monitoring.",
        "Custom Pitch Angle": "Virtual Guarding AI Platform: Instant Telegram alert dispatch to field guards with snapshot evidence."
    },
    {
        "Company Name": "G4S India (Allied Universal)",
        "Region": "India / Global",
        "Category": "Enterprise Physical & Electronic Security",
        "Target Decision Maker Role": "Head of Technology Solutions / Commercial Director",
        "Recommended Email / Contact": "tech.solutions@in.g4s.com / sales@in.g4s.com",
        "Email Format Pattern": "first.last@g4s.com",
        "Why They Need CamAI": "G4S offers electronic surveillance monitoring. CamAI allows them to launch a white-label SaaS monitoring product for corporate clients.",
        "Custom Pitch Angle": "White-Label AI Video Surveillance SaaS Platform for Commercial Facilities."
    },
    {
        "Company Name": "Securitas India",
        "Region": "India / Global",
        "Category": "Electronic Security & Remote Operations",
        "Target Decision Maker Role": "VP Technology Operations / Innovation Lead",
        "Recommended Email / Contact": "info@securitas.in / tech.operations@securitas.com",
        "Email Format Pattern": "first.last@securitas.com",
        "Why They Need CamAI": "Securitas is transitioning to remote video monitoring center (SOC). CamAI's decoupled video & telemetry streaming prevents SOC bandwidth overload.",
        "Custom Pitch Angle": "Remote Operations Center (SOC) Decoupled AI Telemetry Software Asset."
    },

    # Category 5: Regional Traffic & Industrial AI Integrators
    {
        "Company Name": "Kent Intelligent Transportation",
        "Region": "India",
        "Category": "ITS & Highway Traffic Integrator",
        "Target Decision Maker Role": "Managing Director / Chief System Architect",
        "Recommended Email / Contact": "info@kentits.com / tech@kentits.com",
        "Email Format Pattern": "first.last@kentits.com",
        "Why They Need CamAI": "Kent ITS builds electronic toll collection & highway surveillance. CamAI delivers homography speed gates and ANPR optical recognition.",
        "Custom Pitch Angle": "Homography Speed Gate & ANPR Engine Software Asset Licensing."
    },
    {
        "Company Name": "Logicgrid Industrial Solutions",
        "Region": "India / UAE",
        "Category": "Industrial IoT & Vision Integrator",
        "Target Decision Maker Role": "Head of Vision AI / Managing Director",
        "Recommended Email / Contact": "contact@logicgrid.in / director@logicgrid.in",
        "Email Format Pattern": "first.last@logicgrid.in",
        "Why They Need CamAI": "Logicgrid builds industrial automation. CamAI provides factory mode headcount, restricted zone polygon drawing, and schedule gating.",
        "Custom Pitch Angle": "Factory Safety & Perimeter Intrusion Detection Engine Acquisition."
    }
]

# Write CSV
csv_file = "d:/camAI/docs/CamAI_Enterprise_Outreach_Leads.csv"
fieldnames = list(leads[0].keys())

with open(csv_file, mode="w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(leads)

print(f"CSV successfully generated at: {csv_file}")

# Try creating XLSX if openpyxl is installed
try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "CamAI Target Buyer Leads"

    # Header styling
    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    data_font = Font(name="Calibri", size=10, color="000000")
    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    ws.append(fieldnames)
    for col_num in range(1, len(fieldnames) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for row_idx, lead in enumerate(leads, start=2):
        row_data = [lead[col] for col in fieldnames]
        ws.append(row_data)
        for col_num in range(1, len(fieldnames) + 1):
            cell = ws.cell(row=row_idx, column=col_num)
            cell.font = data_font
            cell.border = thin_border
            if col_num in [1, 2, 3]:
                cell.alignment = Alignment(vertical="top")
                if col_num == 1:
                    cell.font = Font(name="Calibri", size=10, bold=True, color="000000")
            else:
                cell.alignment = Alignment(vertical="top", wrap_text=True)

    # Set column widths
    widths = [26, 16, 28, 30, 36, 25, 45, 35]
    for idx, width in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = width

    xlsx_file = "d:/camAI/docs/CamAI_Enterprise_Outreach_Leads.xlsx"
    wb.save(xlsx_file)
    print(f"XLSX successfully generated at: {xlsx_file}")

except Exception as e:
    print(f"XLSX creation skipped (openpyxl not available): {e}")
