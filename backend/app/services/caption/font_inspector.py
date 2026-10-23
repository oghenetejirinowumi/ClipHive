"""Lightweight TrueType / OpenType font inspector to extract font family names."""
from __future__ import annotations

import struct
from pathlib import Path


def extract_font_family_name(font_path: str | Path) -> str | None:
    """
    Parses TrueType / OpenType binary table headers to extract the internal font family name (NameID 1 or 4).
    Guarantees that libass matches the font correctly regardless of file name.
    """
    try:
        with open(font_path, "rb") as f:
            data = f.read()

        if len(data) < 12:
            return None

        # Read Offset Table
        num_tables = struct.unpack(">H", data[4:6])[0]
        name_table_offset = None

        # Iterate through Table Directory entries (16 bytes each)
        for i in range(num_tables):
            entry_offset = 12 + i * 16
            tag = data[entry_offset : entry_offset + 4]
            if tag == b"name":
                name_table_offset = struct.unpack(">I", data[entry_offset + 8 : entry_offset + 12])[0]
                break

        if name_table_offset is None or name_table_offset >= len(data):
            return None

        # Read 'name' Table header
        name_header = data[name_table_offset : name_table_offset + 6]
        count, string_offset_rel = struct.unpack(">HH", name_header[2:6])
        storage_offset = name_table_offset + string_offset_rel

        candidates = {}

        # Scan Name Records (12 bytes each)
        for i in range(count):
            rec_offset = name_table_offset + 6 + i * 12
            platform_id, enc_id, lang_id, name_id, length, offset = struct.unpack(
                ">HHHHHH", data[rec_offset : rec_offset + 12]
            )

            # NameID 1 = Font Family, NameID 4 = Full Name
            if name_id in (1, 4):
                str_start = storage_offset + offset
                str_end = str_start + length
                raw_bytes = data[str_start:str_end]

                # Decode according to platform
                decoded = None
                if platform_id == 3:  # Windows Unicode (UTF-16BE)
                    try:
                        decoded = raw_bytes.decode("utf-16-be").strip()
                    except UnicodeDecodeError:
                        pass
                elif platform_id == 1:  # Mac Roman
                    try:
                        decoded = raw_bytes.decode("latin-1").strip()
                    except UnicodeDecodeError:
                        pass

                if decoded and name_id not in candidates:
                    candidates[name_id] = decoded

        # Prefer Family name (NameID 1), then Full name (NameID 4)
        return candidates.get(1) or candidates.get(4)

    except Exception:
        return None
