function write_biff_rec(ba/*:BufArray*/, type/*:number*/, payload, length/*:?number*/)/*:void*/ {
	var t/*:number*/ = type;
	if(isNaN(t)) return;
	var len = length || (payload||[]).length || 0;
	var o = ba.next(4);
	o.write_shift(2, t);
	o.write_shift(2, len);
	if(/*:: len != null &&*/len > 0 && is_buf(payload)) ba.push(payload);
}

function write_biff_continue(ba/*:BufArray*/, type/*:number*/, payload, length/*:?number*/)/*:void*/ {
	var len = length || (payload||[]).length || 0;
	if(len <= 8224) return write_biff_rec(ba, type, payload, len);
	var t = type;
	if(isNaN(t)) return;
	var parts = payload.parts || [], sidx = 0;
	var i = 0, w = 0;
	while(w + (parts[sidx] || 8224) <= 8224) { w+= (parts[sidx] || 8224); sidx++; }
	var o = ba.next(4);
	o.write_shift(2, t);
	o.write_shift(2, w);
	ba.push(payload.slice(i, i + w));
	i += w;
	while(i < len) {
		o = ba.next(4);
		o.write_shift(2, 0x3c); // TODO: figure out correct continue type
		w = 0;
		while(w + (parts[sidx] || 8224) <= 8224) { w+= (parts[sidx] || 8224); sidx++; }
		o.write_shift(2, w);
		ba.push(payload.slice(i, i+w)); i+= w;
	}
}

function write_BIFF2Cell(out, r/*:number*/, c/*:number*/) {
	if(!out) out = new_buf(7);
	out.write_shift(2, r);
	out.write_shift(2, c);
	out.write_shift(2, 0);
	out.write_shift(1, 0);
	return out;
}

function write_BIFF2BERR(r/*:number*/, c/*:number*/, val, t/*:?string*/) {
	var out = new_buf(9);
	write_BIFF2Cell(out, r, c);
	write_Bes(val, t || 'b', out);
	return out;
}

/* TODO: codepage, large strings */
function write_BIFF2LABEL(r/*:number*/, c/*:number*/, val) {
	var out = new_buf(8 + 2*val.length);
	write_BIFF2Cell(out, r, c);
	out.write_shift(1, val.length);
	out.write_shift(val.length, val, 'sbcs');
	return out.l < out.length ? out.slice(0, out.l) : out;
}

function write_ws_biff2_cell(ba/*:BufArray*/, cell/*:Cell*/, R/*:number*/, C/*:number*//*::, opts*/) {
	if(cell.v != null) switch(cell.t) {
		case 'd': case 'n':
			var v = cell.t == 'd' ? datenum(parseDate(cell.v)) : cell.v;
			if((v == (v|0)) && (v >= 0) && (v < 65536))
				write_biff_rec(ba, 0x0002, write_BIFF2INT(R, C, v));
			else
				write_biff_rec(ba, 0x0003, write_BIFF2NUM(R,C, v));
			return;
		case 'b': case 'e': write_biff_rec(ba, 0x0005, write_BIFF2BERR(R, C, cell.v, cell.t)); return;
		/* TODO: codepage, sst */
		case 's': case 'str':
			write_biff_rec(ba, 0x0004, write_BIFF2LABEL(R, C, (cell.v||"").slice(0,255)));
			return;
	}
	write_biff_rec(ba, 0x0001, write_BIFF2Cell(null, R, C));
}

function write_ws_biff2(ba/*:BufArray*/, ws/*:Worksheet*/, idx/*:number*/, opts/*::, wb:Workbook*/) {
	var dense = Array.isArray(ws);
	var range = safe_decode_range(ws['!ref'] || "A1"), ref/*:string*/, rr = "", cols/*:Array<string>*/ = [];
	if(range.e.c > 0xFF || range.e.r > 0x3FFF) {
		if(opts.WTF) throw new Error("Range " + (ws['!ref'] || "A1") + " exceeds format limit A1:IV16384");
		range.e.c = Math.min(range.e.c, 0xFF);
		range.e.r = Math.min(range.e.c, 0x3FFF);
		ref = encode_range(range);
	}
	for(var R = range.s.r; R <= range.e.r; ++R) {
		rr = encode_row(R);
		for(var C = range.s.c; C <= range.e.c; ++C) {
			if(R === range.s.r) cols[C] = encode_col(C);
			ref = cols[C] + rr;
			var cell = dense ? (ws[R]||[])[C] : ws[ref];
			if(!cell) continue;
			/* write cell */
			write_ws_biff2_cell(ba, cell, R, C, opts);
		}
	}
}

/* Based on test files */
function write_biff2_buf(wb/*:Workbook*/, opts/*:WriteOpts*/) {
	var o = opts || {};
	if(DENSE != null && o.dense == null) o.dense = DENSE;
	var ba = buf_array();
	var idx = 0;
	for(var i=0;i<wb.SheetNames.length;++i) if(wb.SheetNames[i] == o.sheet) idx=i;
	if(idx == 0 && !!o.sheet && wb.SheetNames[0] != o.sheet) throw new Error("Sheet not found: " + o.sheet);
	write_biff_rec(ba, (o.biff == 4 ? 0x0409 : (o.biff == 3 ? 0x0209 : 0x0009)), write_BOF(wb, 0x10, o));
	/* ... */
	write_ws_biff2(ba, wb.Sheets[wb.SheetNames[idx]], idx, o, wb);
	/* ... */
	write_biff_rec(ba, 0x000A);
	return ba.end();
}

function write_FONTS_biff8(ba, data, opts) {
	write_biff_rec(ba, 0x0031 /* Font */, write_Font({
		sz:12,
		color: {theme:1},
		name: "Arial",
		family: 2,
		scheme: "minor"
	}, opts));
}


function write_FMTS_biff8(ba, NF/*:?SSFTable*/, opts) {
	if(!NF) return;
	[[5,8],[23,26],[41,44],[/*63*/50,/*66],[164,*/392]].forEach(function(r) {
		/*:: if(!NF) return; */
		for(var i = r[0]; i <= r[1]; ++i) if(NF[i] != null) write_biff_rec(ba, 0x041E /* Format */, write_Format(i, NF[i], opts));
	});
}

function write_FEAT(ba, ws) {
	/* [MS-XLS] 2.4.112 */
	var o = new_buf(19);
	o.write_shift(4, 0x867); o.write_shift(4, 0); o.write_shift(4, 0);
	o.write_shift(2, 3); o.write_shift(1, 1); o.write_shift(4, 0);
	write_biff_rec(ba, 0x0867 /* FeatHdr */, o);
	/* [MS-XLS] 2.4.111 */
	o = new_buf(39);
	o.write_shift(4, 0x868); o.write_shift(4, 0); o.write_shift(4, 0);
	o.write_shift(2, 3); o.write_shift(1, 0); o.write_shift(4, 0);
	o.write_shift(2, 1); o.write_shift(4, 4); o.write_shift(2, 0);
	write_Ref8U(safe_decode_range(ws['!ref']||"A1"), o);
	o.write_shift(4, 4);
	write_biff_rec(ba, 0x0868 /* Feat */, o);
}

function write_CELLXFS_biff8(ba, opts) {
	for(var i = 0; i < 16; ++i) write_biff_rec(ba, 0x00e0 /* XF */, write_XF({numFmtId:0, style:true}, 0, opts));
	opts.cellXfs.forEach(function(c) {
		write_biff_rec(ba, 0x00e0 /* XF */, write_XF(c, 0, opts));
	});
}

function write_ws_biff8_hlinks(ba/*:BufArray*/, ws) {
	for(var R=0; R<ws['!links'].length; ++R) {
		var HL = ws['!links'][R];
		write_biff_rec(ba, 0x01b8 /* HLink */, write_HLink(HL));
		if(HL[1].Tooltip) write_biff_rec(ba, 0x0800 /* HLinkTooltip */, write_HLinkTooltip(HL));
	}
	delete ws['!links'];
}

function write_ws_cols_biff8(ba, cols) {
	if(!cols) return;
	var cnt = 0;
	cols.forEach(function(col, idx) {
		if(++cnt <= 256 && col) {
			write_biff_rec(ba, 0x007d /* ColInfo */, write_ColInfo(col_obj_w(idx, col), idx));
		}
	});
}

function write_ws_biff8_cell(ba/*:BufArray*/, cell/*:Cell*/, R/*:number*/, C/*:number*/, opts) {
	var os = 16 + get_cell_style(opts.cellXfs, cell, opts);
	if(cell.v == null && !cell.bf) {
		write_biff_rec(ba, 0x0201 /* Blank */, write_XLSCell(R, C, os));
		return;
	}
	if(cell.bf) write_biff_rec(ba, 0x0006 /* Formula */, write_Formula(cell, R, C, opts, os));
	else switch(cell.t) {
		case 'd': case 'n':
			var v = cell.t == 'd' ? datenum(parseDate(cell.v)) : cell.v;
			/* TODO: emit RK as appropriate */
			write_biff_rec(ba, 0x0203 /* Number */, write_Number(R, C, v, os, opts));
			break;
		case 'b': case 'e':
			write_biff_rec(ba, 0x0205 /* BoolErr */, write_BoolErr(R, C, cell.v, os, opts, cell.t));
			break;
		/* TODO: codepage, sst */
		case 's': case 'str':
			if(opts.bookSST) {
				var isst = get_sst_id(opts.Strings, cell.v, opts.revStrings);
				write_biff_rec(ba, 0x00fd /* LabelSst */, write_LabelSst(R, C, isst, os, opts));
			} else write_biff_rec(ba, 0x0204 /* Label */, write_Label(R, C, (cell.v||"").slice(0,255), os, opts));
			break;
		default:
			write_biff_rec(ba, 0x0201 /* Blank */, write_XLSCell(R, C, os));
	}
}

/* [MS-XLS] 2.1.7.20.5 */
function write_ws_biff8(idx/*:number*/, opts, wb/*:Workbook*/) {
	var ba = buf_array();
	var s = wb.SheetNames[idx], ws = wb.Sheets[s] || {};
	var _WB/*:WBWBProps*/ = ((wb||{}).Workbook||{}/*:any*/);
	var _sheet/*:WBWSProp*/ = ((_WB.Sheets||[])[idx]||{}/*:any*/);
	var dense = Array.isArray(ws);
	var b8 = opts.biff == 8;
	var ref/*:string*/, rr = "", cols/*:Array<string>*/ = [];
	var range = safe_decode_range(ws['!ref'] || "A1");
	var MAX_ROWS = b8 ? 65536 : 16384;
	if(range.e.c > 0xFF || range.e.r >= MAX_ROWS) {
		if(opts.WTF) throw new Error("Range " + (ws['!ref'] || "A1") + " exceeds format limit A1:IV16384");
		range.e.c = Math.min(range.e.c, 0xFF);
		range.e.r = Math.min(range.e.c, MAX_ROWS-1);
	}

	write_biff_rec(ba, 0x0809, write_BOF(wb, 0x10, opts));
	/* [Uncalced] Index */
	write_biff_rec(ba, 0x000d /* CalcMode */, writeuint16(1));
	write_biff_rec(ba, 0x000c /* CalcCount */, writeuint16(100));
	write_biff_rec(ba, 0x000f /* CalcRefMode */, writebool(true));
	write_biff_rec(ba, 0x0011 /* CalcIter */, writebool(false));
	write_biff_rec(ba, 0x0010 /* CalcDelta */, write_Xnum(0.001));
	write_biff_rec(ba, 0x005f /* CalcSaveRecalc */, writebool(true));
	write_biff_rec(ba, 0x002a /* PrintRowCol */, writebool(false));
	write_biff_rec(ba, 0x002b /* PrintGrid */, writebool(false));
	write_biff_rec(ba, 0x0082 /* GridSet */, writeuint16(1));
	write_biff_rec(ba, 0x0080 /* Guts */, write_Guts([0,0]));
	/* DefaultRowHeight WsBool [Sync] [LPr] [HorizontalPageBreaks] [VerticalPageBreaks] */
	/* Header (string) */
	/* Footer (string) */
	write_biff_rec(ba, 0x0083 /* HCenter */, writebool(false));
	write_biff_rec(ba, 0x0084 /* VCenter */, writebool(false));
	/* ... */
	if(b8) write_ws_cols_biff8(ba, ws["!cols"]);
	/* ... */
	write_biff_rec(ba, 0x0200 /* Dimensions */, write_Dimensions(range, opts));
	/* ... */

	if(b8) ws['!links'] = [];
	for(var R = range.s.r; R <= range.e.r; ++R) {
		rr = encode_row(R);
		for(var C = range.s.c; C <= range.e.c; ++C) {
			if(R === range.s.r) cols[C] = encode_col(C);
			ref = cols[C] + rr;
			var cell = dense ? (ws[R]||[])[C] : ws[ref];
			if(!cell) continue;
			/* write cell */
			write_ws_biff8_cell(ba, cell, R, C, opts);
			if(b8 && cell.l) ws['!links'].push([ref, cell.l]);
		}
	}
	var cname/*:string*/ = _sheet.CodeName || _sheet.name || s;
	/* ... */
	if(b8) write_biff_rec(ba, 0x023e /* Window2 */, write_Window2((_WB.Views||[])[0]));
	/* ... */
	if(b8 && (ws['!merges']||[]).length) write_biff_rec(ba, 0x00e5 /* MergeCells */, write_MergeCells(ws['!merges']));
	/* [LRng] *QUERYTABLE [PHONETICINFO] CONDFMTS */
	if(b8) write_ws_biff8_hlinks(ba, ws);
	/* [DVAL] */
	write_biff_rec(ba, 0x01ba /* CodeName */, write_XLUnicodeString(cname, opts));
	/* *WebPub *CellWatch [SheetExt] */
	if(b8) write_FEAT(ba, ws);
	/* *FEAT11 *RECORD12 */
	write_biff_rec(ba, 0x000a /* EOF */);
	return ba.end();
}

/* [MS-XLS] 2.1.7.20.3 */
function write_biff8_global(wb/*:Workbook*/, bufs, opts/*:WriteOpts*/) {
	var A = buf_array();
	var _WB/*:WBWBProps*/ = ((wb||{}).Workbook||{}/*:any*/);
	var _sheets/*:Array<WBWSProp>*/ = (_WB.Sheets||[]);
	var _wb/*:WBProps*/ = /*::((*/_WB.WBProps||{/*::CodeName:"ThisWorkbook"*/}/*:: ):any)*/;
	var b8 = opts.biff == 8, b5 = opts.biff == 5;
	write_biff_rec(A, 0x0809, write_BOF(wb, 0x05, opts));
	if(opts.bookType == "xla") write_biff_rec(A, 0x0087 /* Addin */);
	write_biff_rec(A, 0x00e1 /* InterfaceHdr */, b8 ? writeuint16(0x04b0) : null);
	write_biff_rec(A, 0x00c1 /* Mms */, writezeroes(2));
	if(b5) write_biff_rec(A, 0x00bf /* ToolbarHdr */);
	if(b5) write_biff_rec(A, 0x00c0 /* ToolbarEnd */);
	write_biff_rec(A, 0x00e2 /* InterfaceEnd */);
	write_biff_rec(A, 0x005c /* WriteAccess */, write_WriteAccess("SheetJS", opts));
	/* [FileSharing] */
	write_biff_rec(A, 0x0042 /* CodePage */, writeuint16(b8 ? 0x04b0 : 0x04E4));
	/* *2047 Lel */
	if(b8) write_biff_rec(A, 0x0161 /* DSF */, writeuint16(0));
	if(b8) write_biff_rec(A, 0x01c0 /* Excel9File */);
	write_biff_rec(A, 0x013d /* RRTabId */, write_RRTabId(wb.SheetNames.length));
	if(b8 && wb.vbaraw) write_biff_rec(A, 0x00d3 /* ObProj */);
	/* [ObNoMacros] */
	if(b8 && wb.vbaraw) {
		var cname/*:string*/ = _wb.CodeName || "ThisWorkbook";
		write_biff_rec(A, 0x01ba /* CodeName */, write_XLUnicodeString(cname, opts));
	}
	write_biff_rec(A, 0x009c /* BuiltInFnGroupCount */, writeuint16(0x11));
	/* *FnGroupName *FnGrp12 */
	/* *Lbl */
	/* [OleObjectSize] */
	write_biff_rec(A, 0x0019 /* WinProtect */, writebool(false));
	write_biff_rec(A, 0x0012 /* Protect */, writebool(false));
	write_biff_rec(A, 0x0013 /* Password */, writeuint16(0));
	if(b8) write_biff_rec(A, 0x01af /* Prot4Rev */, writebool(false));
	if(b8) write_biff_rec(A, 0x01bc /* Prot4RevPass */, writeuint16(0));
	write_biff_rec(A, 0x003d /* Window1 */, write_Window1(opts));
	write_biff_rec(A, 0x0040 /* Backup */, writebool(false));
	write_biff_rec(A, 0x008d /* HideObj */, writeuint16(0));
	write_biff_rec(A, 0x0022 /* Date1904 */, writebool(safe1904(wb)=="true"));
	write_biff_rec(A, 0x000e /* CalcPrecision */, writebool(true));
	if(b8) write_biff_rec(A, 0x01b7 /* RefreshAll */, writebool(false));
	write_biff_rec(A, 0x00DA /* BookBool */, writeuint16(0));
	/* ... */
	write_FONTS_biff8(A, wb, opts);
	write_FMTS_biff8(A, wb.SSF, opts);
	write_CELLXFS_biff8(A, opts);
	/* ... */
	if(b8) write_biff_rec(A, 0x0160 /* UsesELFs */, writebool(false));
	var a = A.end();

	var C = buf_array();
	/* METADATA [MTRSettings] [ForceFullCalculation] */
	if(b8) write_biff_rec(C, 0x008C /* Country */, write_Country());
	/* *SUPBOOK *LBL *RTD [RecalcId] *HFPicture *MSODRAWINGGROUP */

	/* BIFF8: [SST *Continue] ExtSST */
	if(b8 && opts.Strings) write_biff_continue(C, 0x00FC /* SST */, write_SST(opts.Strings, opts));

	/* *WebPub [WOpt] [CrErr] [BookExt] *FeatHdr *DConn [THEME] [CompressPictures] [Compat12] [GUIDTypeLib] */
	write_biff_rec(C, 0x000A /* EOF */);
	var c = C.end();

	var B = buf_array();
	var blen = 0, j = 0;
	for(j = 0; j < wb.SheetNames.length; ++j) blen += (b8 ? 12 : 11) + (b8 ? 2 : 1) * wb.SheetNames[j].length;
	var start = a.length + blen + c.length;
	for(j = 0; j < wb.SheetNames.length; ++j) {
		var _sheet/*:WBWSProp*/ = _sheets[j] || ({}/*:any*/);
		write_biff_rec(B, 0x0085 /* BoundSheet8 */, write_BoundSheet8({pos:start, hs:_sheet.Hidden||0, dt:0, name:wb.SheetNames[j]}, opts));
		start += bufs[j].length;
	}
	/* 1*BoundSheet8 */
	var b = B.end();
	if(blen != b.length) throw new Error("BS8 " + blen + " != " + b.length);

	var out = [];
	if(a.length) out.push(a);
	if(b.length) out.push(b);
	if(c.length) out.push(c);
	return bconcat(out);
}

/* [MS-XLS] 2.1.7.20 Workbook Stream */
function write_biff8_buf(wb/*:Workbook*/, opts/*:WriteOpts*/) {
	var o = opts || {};
	var bufs = [];

	if(wb && !wb.SSF) {
		wb.SSF = dup(table_fmt);
	}
	if(wb && wb.SSF) {
		make_ssf(); SSF_load_table(wb.SSF);
		// $FlowIgnore
		o.revssf = evert_num(wb.SSF); o.revssf[wb.SSF[65535]] = 0;
		o.ssf = wb.SSF;
	}

	o.Strings = /*::((*/[]/*:: :any):SST)*/; o.Strings.Count = 0; o.Strings.Unique = 0;
	fix_write_opts(o);

	o.cellXfs = [];
	get_cell_style(o.cellXfs, {}, {revssf:{"General":0}});

	if(!wb.Props) wb.Props = {};

	for(var i = 0; i < wb.SheetNames.length; ++i) bufs[bufs.length] = write_ws_biff8(i, o, wb);
	bufs.unshift(write_biff8_global(wb, bufs, o));
	return bconcat(bufs);
}

function write_biff_buf(wb/*:Workbook*/, opts/*:WriteOpts*/) {
	for(var i = 0; i <= wb.SheetNames.length; ++i) {
		var ws = wb.Sheets[wb.SheetNames[i]];
		if(!ws || !ws["!ref"]) continue;
		var range = decode_range(ws["!ref"]);
		if(range.e.c > 255) { // note: 255 is IV
			if(typeof console != "undefined" && console.error) console.error("Worksheet '" + wb.SheetNames[i] + "' extends beyond column IV (255).  Data may be lost.");
		}
	}

	var o = opts || {};
	switch(o.biff || 2) {
		case 8: case 5: return write_biff8_buf(wb, opts);
		case 4: case 3: case 2: return write_biff2_buf(wb, opts);
	}
	throw new Error("invalid type " + o.bookType + " for BIFF");
}
